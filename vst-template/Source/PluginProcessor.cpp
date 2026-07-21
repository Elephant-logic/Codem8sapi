#include "PluginProcessor.h"

namespace {
struct Sound final : juce::SynthesiserSound { bool appliesToNote(int) override { return true; } bool appliesToChannel(int) override { return true; } };
struct Voice final : juce::SynthesiserVoice {
    bool canPlaySound(juce::SynthesiserSound* s) override { return dynamic_cast<Sound*>(s) != nullptr; }
    void startNote(int midiNoteNumber, float velocity, juce::SynthesiserSound*, int) override {
        level = velocity * 0.22f; phase = 0.0; tail = 0.0;
        delta = juce::MathConstants<double>::twoPi * juce::MidiMessage::getMidiNoteInHertz(midiNoteNumber) / getSampleRate();
    }
    void stopNote(float, bool allowTailOff) override { if (allowTailOff) tail = 1.0; else clearCurrentNote(); }
    void pitchWheelMoved(int) override {}
    void controllerMoved(int, int) override {}
    void renderNextBlock(juce::AudioBuffer<float>& out, int start, int count) override {
        if (delta == 0.0) return;
        while (--count >= 0) {
            float sample = 0.0f;
#if CODEM8S_WAVEFORM == 0
            sample = std::sin(phase);
#elif CODEM8S_WAVEFORM == 1
            sample = static_cast<float>((phase / juce::MathConstants<double>::pi) - 1.0);
#elif CODEM8S_WAVEFORM == 2
            sample = phase < juce::MathConstants<double>::pi ? 1.0f : -1.0f;
#else
            sample = static_cast<float>(2.0 * std::abs(2.0 * (phase / juce::MathConstants<double>::twoPi) - 1.0) - 1.0);
#endif
            float env = tail > 0.0 ? static_cast<float>(tail) : 1.0f;
            sample *= level * env;
            for (int ch = 0; ch < out.getNumChannels(); ++ch) out.addSample(ch, start, sample);
            phase += delta; if (phase >= juce::MathConstants<double>::twoPi) phase -= juce::MathConstants<double>::twoPi;
            ++start;
            if (tail > 0.0 && (tail *= 0.992) < 0.005) { clearCurrentNote(); delta = 0.0; break; }
        }
    }
    double phase = 0.0, delta = 0.0, tail = 0.0; float level = 0.0f;
};
}

Codem8sInstrumentAudioProcessor::Codem8sInstrumentAudioProcessor()
: AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)),
  parameters(*this, nullptr, "PARAMS", { std::make_unique<juce::AudioParameterFloat>("gain", "Gain", 0.0f, 1.0f, 0.8f) }) {
    for (int i = 0; i < 8; ++i) synth.addVoice(new Voice());
    synth.addSound(new Sound());
}
void Codem8sInstrumentAudioProcessor::prepareToPlay(double sr, int) { synth.setCurrentPlaybackSampleRate(sr); }
bool Codem8sInstrumentAudioProcessor::isBusesLayoutSupported(const BusesLayout& l) const { return l.getMainOutputChannelSet() == juce::AudioChannelSet::mono() || l.getMainOutputChannelSet() == juce::AudioChannelSet::stereo(); }
void Codem8sInstrumentAudioProcessor::processBlock(juce::AudioBuffer<float>& b, juce::MidiBuffer& m) { b.clear(); synth.renderNextBlock(b, m, 0, b.getNumSamples()); b.applyGain(parameters.getRawParameterValue("gain")->load()); }
juce::AudioProcessorEditor* Codem8sInstrumentAudioProcessor::createEditor() { return new juce::GenericAudioProcessorEditor(*this); }
void Codem8sInstrumentAudioProcessor::getStateInformation(juce::MemoryBlock& dest) { auto xml = parameters.copyState().createXml(); copyXmlToBinary(*xml, dest); }
void Codem8sInstrumentAudioProcessor::setStateInformation(const void* data, int size) { if (auto xml = getXmlFromBinary(data, size)) parameters.replaceState(juce::ValueTree::fromXml(*xml)); }
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new Codem8sInstrumentAudioProcessor(); }
