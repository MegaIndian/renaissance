# ADR 0003: react-native-track-player plus a small native audio module

Date: 2026-11-17. Status: accepted.

## Context

Mobile needs background audio, lock-screen controls, headphone buttons, Android Auto, and the v1 audio
features: ten-band EQ, ReplayGain and crossfade with album-aware gapless. `react-native-track-player`
(RNTP) covers playback and controls but has no EQ, gain or crossfade.

## Decision

RNTP is the player, queue and media-session layer on mobile. A small Expo Module adds the DSP: Swift
(`AVAudioEngine` with `AVAudioUnitEQ`, a gain node and two players for crossfade) and Kotlin (ExoPlayer with
`Equalizer` and `LoudnessEnhancer`, two players for crossfade). On web the same features are a Web Audio
graph: two `HTMLAudioElement`s into `MediaElementSource -> GainNode (ReplayGain) -> 10 BiquadFilters ->
GainNode (crossfade) -> destination`, with the MediaSession API for keys and lock screens. Core only talks
to an `AudioEngine` interface.

## Consequences

- This is the largest native risk; it is scheduled in phase 3 before offline work so it is known early.
- Fallback if the module fights RNTP's player: a fork of RNTP with the DSP added, or `react-native-audio-api`.
- Crossfade is disabled between tracks of the same album when gapless is on, and never used in CarPlay.

## Note (2026-11-17, phase 0 rework)

Phase numbers follow the revised table in the build program: the native audio module ships in phase 3
(Mobile + audio), after the hub (phase 2). The earlier plan's Risks table still says "phase 2" from
its original eight-phase layout; this ADR and the build program are the reference.
