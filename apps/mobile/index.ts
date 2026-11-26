/**
 * The app's entry: RNTP's playback service is registered before expo-router mounts the screens
 * (react-native-track-player needs it at startup to keep playing in the background).
 */
import './src/lib/quiet-logs';

import TrackPlayer from 'react-native-track-player';

import { PlaybackService } from './src/lib/service';

TrackPlayer.registerPlaybackService(() => PlaybackService);

import 'expo-router/entry';
