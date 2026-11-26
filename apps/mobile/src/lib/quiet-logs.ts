/**
 * Imported first by the entry: RNTP 4.1.2 declares sleep-timer methods in JS that its iOS module
 * does not implement, the app never calls them, and the new architecture's interop layer warns about
 * each one as the module loads. Everything else still reaches the warning box.
 */
import { LogBox } from 'react-native';

LogBox.ignoreLogs([/method signature for the JS method `\w*[Ss]leep\w*` can not be found/]);
