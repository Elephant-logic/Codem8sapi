cmake_minimum_required(VERSION 3.22)
project(Codem8sGeneratedInstrument VERSION 1.0.0)
include(FetchContent)
FetchContent_Declare(JUCE GIT_REPOSITORY https://github.com/juce-framework/JUCE.git GIT_TAG 8.0.6)
FetchContent_MakeAvailable(JUCE)

juce_add_plugin(Codem8sInstrument
  COMPANY_NAME "__MANUFACTURER__"
  BUNDLE_ID "com.codem8s.__PLUGIN_ID__"
  PLUGIN_MANUFACTURER_CODE Cdm8
  PLUGIN_CODE C8I1
  FORMATS VST3
  PRODUCT_NAME "__PLUGIN_NAME__"
  IS_SYNTH TRUE
  NEEDS_MIDI_INPUT TRUE
  NEEDS_MIDI_OUTPUT FALSE
  IS_MIDI_EFFECT FALSE
  EDITOR_WANTS_KEYBOARD_FOCUS FALSE
  COPY_PLUGIN_AFTER_BUILD FALSE)

target_sources(Codem8sInstrument PRIVATE Source/PluginProcessor.cpp Source/PluginProcessor.h)
target_compile_definitions(Codem8sInstrument PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 CODEM8S_WAVEFORM=__WAVEFORM__)
target_link_libraries(Codem8sInstrument PRIVATE juce::juce_audio_utils juce::juce_dsp PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_lto_flags juce::juce_recommended_warning_flags)
