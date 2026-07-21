#include "PluginProcessor.h"

namespace {
struct Sound final : juce::SynthesiserSound {
    bool appliesToNote(int) override { return true; }
    bool appliesToChannel(int) override { return true; }
};

struct Voice final : juce::SynthesiserVoice {
    Voice(std::atomic<float>* waveIn, std::atomic<float>* aIn, std::atomic<float>* dIn,
          std::atomic<float>* sIn, std::atomic<float>* rIn, std::atomic<float>* cutoffIn)
        : wave(waveIn), a(aIn), d(dIn), s(sIn), r(rIn), cutoff(cutoffIn) {}

    bool canPlaySound(juce::SynthesiserSound* sound) override { return dynamic_cast<Sound*>(sound) != nullptr; }

    void startNote(int note, float velocity, juce::SynthesiserSound*, int wheel) override {
        midiNote = note; level = velocity * 0.22f; phase = 0.0; filterState = 0.0f;
        setEnvelope(); pitchWheelMoved(wheel); env.noteOn();
    }

    void stopNote(float, bool tail) override {
        if (tail) env.noteOff(); else { env.reset(); clearCurrentNote(); }
    }

    void pitchWheelMoved(int value) override {
        bend = ((float)value - 8192.0f) / 8192.0f * 2.0f;
        updateDelta();
    }

    void controllerMoved(int, int) override {}

    void renderNextBlock(juce::AudioBuffer<float>& out, int start, int count) override {
        if (!isVoiceActive()) return;
        setEnvelope(); updateDelta();
        const float sr = (float)getSampleRate();
        const float hz = juce::jlimit(20.0f, sr * 0.45f, cutoff->load());
        const float alpha = 1.0f - std::exp(-juce::MathConstants<float>::twoPi * hz / sr);
        const int type = juce::jlimit(0, 3, (int)wave->load());

        for (int i = 0; i < count; ++i) {
            if (!env.isActive()) { clearCurrentNote(); break; }
            float sample = 0.0f;
            if (type == 0) sample = std::sin((float)phase);
            else if (type == 1) sample = (float)(phase / juce::MathConstants<double>::pi - 1.0);
            else if (type == 2) sample = phase < juce::MathConstants<double>::pi ? 1.0f : -1.0f;
            else sample = (float)(2.0 * std::abs(2.0 * phase / juce::MathConstants<double>::twoPi - 1.0) - 1.0);

            sample *= level * env.getNextSample();
            filterState += alpha * (sample - filterState);
            for (int ch = 0; ch < out.getNumChannels(); ++ch) out.addSample(ch, start + i, filterState);
            phase += delta;
            if (phase >= juce::MathConstants<double>::twoPi) phase -= juce::MathConstants<double>::twoPi;
        }
    }

    void setEnvelope() {
        juce::ADSR::Parameters p { juce::jmax(0.001f, a->load()), juce::jmax(0.001f, d->load()),
                                  juce::jlimit(0.0f, 1.0f, s->load()), juce::jmax(0.001f, r->load()) };
        env.setSampleRate(getSampleRate()); env.setParameters(p);
    }

    void updateDelta() {
        if (getSampleRate() > 0.0 && midiNote >= 0)
            delta = juce::MathConstants<double>::twoPi * juce::MidiMessage::getMidiNoteInHertz((double)midiNote + bend) / getSampleRate();
    }

    std::atomic<float> *wave, *a, *d, *s, *r, *cutoff;
    juce::ADSR env;
    double phase = 0.0, delta = 0.0;
    float level = 0.0f, bend = 0.0f, filterState = 0.0f;
    int midiNote = -1;
};
}

juce::AudioProcessorValueTreeState::ParameterLayout Codem8sInstrumentAudioProcessor::createParameterLayout() {
    std::vector<std::unique_ptr<juce::RangedAudioParameter>> p;
    p.push_back(std::make_unique<juce::AudioParameterChoice>("waveform", "Waveform", juce::StringArray{"Sine","Saw","Square","Triangle"}, 1));
    p.push_back(std::make_unique<juce::AudioParameterFloat>("attack", "Attack", 0.001f, 5.0f, 0.01f));
    p.push_back(std::make_unique<juce::AudioParameterFloat>("decay", "Decay", 0.001f, 5.0f, 0.2f));
    p.push_back(std::make_unique<juce::AudioParameterFloat>("sustain", "Sustain", 0.0f, 1.0f, 0.75f));
    p.push_back(std::make_unique<juce::AudioParameterFloat>("release", "Release", 0.001f, 10.0f, 0.5f));
    p.push_back(std::make_unique<juce::AudioParameterFloat>("cutoff", "Filter Cutoff", juce::NormalisableRange<float>(20.0f, 20000.0f, 0.1f, 0.25f), 9000.0f));
    p.push_back(std::make_unique<juce::AudioParameterFloat>("gain", "Output Gain", 0.0f, 1.25f, 0.8f));
    return { p.begin(), p.end() };
}

Codem8sInstrumentAudioProcessor::Codem8sInstrumentAudioProcessor()
: AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)),
  parameters(*this, nullptr, "PARAMS", createParameterLayout()) {
    auto* wave = parameters.getRawParameterValue("waveform");
    auto* attack = parameters.getRawParameterValue("attack");
    auto* decay = parameters.getRawParameterValue("decay");
    auto* sustain = parameters.getRawParameterValue("sustain");
    auto* release = parameters.getRawParameterValue("release");
    auto* cutoff = parameters.getRawParameterValue("cutoff");
    for (int i = 0; i < 16; ++i) synth.addVoice(new Voice(wave, attack, decay, sustain, release, cutoff));
    synth.addSound(new Sound());
}

void Codem8sInstrumentAudioProcessor::prepareToPlay(double sr, int blockSize) {
    synth.setCurrentPlaybackSampleRate(sr);
    limiter.prepare({ sr, (juce::uint32)blockSize, 2 });
    limiter.setThreshold(-0.5f);
    limiter.setRelease(80.0f);
}

bool Codem8sInstrumentAudioProcessor::isBusesLayoutSupported(const BusesLayout& l) const {
    return l.getMainOutputChannelSet() == juce::AudioChannelSet::mono() || l.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
}

void Codem8sInstrumentAudioProcessor::processBlock(juce::AudioBuffer<float>& b, juce::MidiBuffer& m) {
    juce::ScopedNoDenormals noDenormals;
    b.clear(); synth.renderNextBlock(b, m, 0, b.getNumSamples());
    b.applyGain(parameters.getRawParameterValue("gain")->load());
    juce::dsp::AudioBlock<float> block(b); juce::dsp::ProcessContextReplacing<float> context(block); limiter.process(context);
}

juce::AudioProcessorEditor* Codem8sInstrumentAudioProcessor::createEditor() { return new juce::GenericAudioProcessorEditor(*this); }
void Codem8sInstrumentAudioProcessor::getStateInformation(juce::MemoryBlock& dest) { if (auto xml = parameters.copyState().createXml()) copyXmlToBinary(*xml, dest); }
void Codem8sInstrumentAudioProcessor::setStateInformation(const void* data, int size) { if (auto xml = getXmlFromBinary(data, size)) parameters.replaceState(juce::ValueTree::fromXml(*xml)); }
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new Codem8sInstrumentAudioProcessor(); }
