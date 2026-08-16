import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import {
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

type ScrollHandler = (e: NativeSyntheticEvent<NativeScrollEvent>) => void;

type HeaderScrollContextValue = {
  scrollY: Animated.Value;
  onScroll: ScrollHandler;
  headerInset: number;
  setHeaderInset: (height: number) => void;
};

const HeaderScrollContext = createContext<HeaderScrollContextValue | null>(
  null
);

/**
 * Kept for compatibility with existing screens.
 * Header is no longer floating/fixed, so contentInsetTop is always 0.
 */
export function DeliveryHeaderScrollProvider({
  children,
}: {
  children: ReactNode;
}) {
  const scrollY = useMemo(() => new Animated.Value(0), []);

  const onScroll = useCallback<ScrollHandler>(
    (e) => {
      scrollY.setValue(e.nativeEvent.contentOffset.y);
    },
    [scrollY]
  );

  const setHeaderInset = useCallback((_height: number) => {
    // no-op — header is not absolutely positioned
  }, []);

  const value = useMemo(
    () => ({ scrollY, onScroll, headerInset: 0, setHeaderInset }),
    [scrollY, onScroll, setHeaderInset]
  );

  return (
    <HeaderScrollContext.Provider value={value}>
      {children}
    </HeaderScrollContext.Provider>
  );
}

export function useDeliveryHeaderScrollY(): Animated.Value {
  const ctx = useContext(HeaderScrollContext);
  if (!ctx) {
    throw new Error(
      'useDeliveryHeaderScrollY must be used within DeliveryHeaderScrollProvider'
    );
  }
  return ctx.scrollY;
}

export function useDeliveryHeaderInset(): number {
  return 0;
}

export function useSetDeliveryHeaderInset(): (height: number) => void {
  const ctx = useContext(HeaderScrollContext);
  return ctx?.setHeaderInset ?? (() => undefined);
}

/** Spread onto page ScrollViews — no top inset (header is not fixed). */
export function useDeliveryHeaderScrollProps(): {
  onScroll?: ScrollHandler;
  scrollEventThrottle: number;
  contentInsetTop: number;
} {
  const ctx = useContext(HeaderScrollContext);
  if (!ctx) {
    return { scrollEventThrottle: 16, contentInsetTop: 0 };
  }
  return {
    onScroll: ctx.onScroll,
    scrollEventThrottle: 16,
    contentInsetTop: 0,
  };
}
