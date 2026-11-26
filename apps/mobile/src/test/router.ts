/** A stand-in for expo-router's hooks; each test reads the calls from `router`. */
export const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};

export const params: Record<string, string> = {};

export const navigation = { setOptions: jest.fn() };

export function expoRouterMock() {
  return {
    useRouter: () => router,
    useLocalSearchParams: () => params,
    useNavigation: () => navigation,
  };
}
