import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { Dimensions, UIManager, findNodeHandle } from 'react-native';
import { isTV } from '../utils/tv';

const TVFocusContext = createContext(null);

const now = () => Date.now();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const isVisibleRect = (rect) => {
  if (!rect || rect.width < 8 || rect.height < 8) return false;
  const { width, height } = Dimensions.get('window');
  return (
    rect.x + rect.width > 0 &&
    rect.y + rect.height > 0 &&
    rect.x < width &&
    rect.y < height
  );
};

const centerOf = (rect) => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

export function TVFocusProvider({ children }) {
  const registryRef = useRef(new Map());
  const focusedIdRef = useRef(null);
  const lastMoveRef = useRef(0);
  const lastSelectRef = useRef(0);
  const lastNativeFocusAtRef = useRef(0);
  const lastFallbackPressRef = useRef(0);
  const autoFocusTimerRef = useRef(null);
  const mountedRef = useRef(true);

  const [focusedId, setFocusedIdState] = useState(null);
  const [cursorRect, setCursorRect] = useState(null);

  const measureItem = useCallback((id) => new Promise((resolve) => {
    const item = registryRef.current.get(id);
    const node = item?.ref?.current;
    if (!node || item?.disabled) {
      resolve(null);
      return;
    }

    const finish = (x, y, width, height) => {
      const rect = { x, y, width, height };
      if (!isVisibleRect(rect)) {
        resolve(null);
        return;
      }
      const latest = registryRef.current.get(id) || item;
      registryRef.current.set(id, { ...latest, rect, lastMeasuredAt: now() });
      resolve({ id, item: latest, rect });
    };

    try {
      if (typeof node.measureInWindow === 'function') {
        node.measureInWindow(finish);
        return;
      }
    } catch (_) {}

    // Fallback más robusto para Android TV/Expo: algunos wrappers no exponen
    // measureInWindow directamente, pero sí entregan un native handle.
    try {
      const handle = findNodeHandle(node);
      if (handle && UIManager?.measureInWindow) {
        UIManager.measureInWindow(handle, finish);
        return;
      }
    } catch (_) {}

    resolve(null);
  }), []);

  const measureAllVisible = useCallback(async () => {
    const ids = Array.from(registryRef.current.keys());
    const measured = await Promise.all(ids.map((id) => measureItem(id)));
    return measured.filter(Boolean);
  }, [measureItem]);

  const applyFocusedId = useCallback(async (id, reason = 'manual') => {
    if (!id || !registryRef.current.has(id)) return false;
    if (reason === 'native') lastNativeFocusAtRef.current = now();
    focusedIdRef.current = id;
    setFocusedIdState(id);

    const measured = await measureItem(id);
    if (measured?.rect && mountedRef.current) {
      const { width, height } = Dimensions.get('window');
      // Selector TV limpio: poco margen para que no parezca una caja gigante.
      const pad = isTV ? 4 : 6;
      const x = clamp(measured.rect.x - pad, 0, Math.max(0, width - 1));
      const y = clamp(measured.rect.y - pad, 0, Math.max(0, height - 1));
      setCursorRect({
        x,
        y,
        width: Math.min(measured.rect.width + pad * 2, Math.max(1, width - x)),
        height: Math.min(measured.rect.height + pad * 2, Math.max(1, height - y)),
        reason,
        updatedAt: now(),
      });
      return true;
    }
    return false;
  }, [measureItem]);

  const chooseFirstVisible = useCallback(async () => {
    if (!isTV) return false;
    const visible = await measureAllVisible();
    if (!visible.length) return false;
    visible.sort((a, b) => {
      const ay = Math.round(a.rect.y / 20);
      const by = Math.round(b.rect.y / 20);
      if (ay !== by) return ay - by;
      return a.rect.x - b.rect.x;
    });
    return applyFocusedId(visible[0].id, 'auto');
  }, [applyFocusedId, measureAllVisible]);

  const scheduleAutoFocus = useCallback(() => {
    if (!isTV) return;
    if (autoFocusTimerRef.current) clearTimeout(autoFocusTimerRef.current);

    // Solo ponemos un foco inicial cuando NO hay nada enfocado todavía.
    // No re-elegimos ni re-aplicamos si ya existe foco: de lo contrario el cursor
    // "salta solo" peleando con el foco nativo del D-pad de Android TV.
    autoFocusTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      if (!focusedIdRef.current || !registryRef.current.has(focusedIdRef.current)) {
        chooseFirstVisible();
      }
    }, 350);
  }, [chooseFirstVisible]);

  const registerFocusable = useCallback((id, config) => {
    if (!id || !config?.ref) return () => {};
    registryRef.current.set(id, { ...config, id, registeredAt: now() });
    scheduleAutoFocus();
    if (isTV && config?.hasTVPreferredFocus) {
      setTimeout(() => {
        if (!focusedIdRef.current) applyFocusedId(id, 'preferred');
      }, 120);
    }
    return () => {
      registryRef.current.delete(id);
      if (focusedIdRef.current === id) {
        focusedIdRef.current = null;
        setFocusedIdState(null);
        setCursorRect(null);
        scheduleAutoFocus();
      }
    };
  }, [applyFocusedId, scheduleAutoFocus]);

  const updateFocusable = useCallback((id, patch) => {
    const current = registryRef.current.get(id);
    if (!current) return;
    registryRef.current.set(id, { ...current, ...patch });
  }, []);

  const refreshFocusedRect = useCallback(() => {
    const id = focusedIdRef.current;
    if (!id) return;
    applyFocusedId(id, 'refresh');
  }, [applyFocusedId]);

  const moveFocus = useCallback(async (direction) => {
    if (!isTV) return false;
    const currentTime = now();
    if (currentTime - lastMoveRef.current < 70) return true;
    lastMoveRef.current = currentTime;

    const visible = await measureAllVisible();
    if (!visible.length) return false;

    const currentId = focusedIdRef.current;
    let current = currentId ? visible.find((entry) => entry.id === currentId) : null;
    if (!current) {
      visible.sort((a, b) => {
        const ay = Math.round(a.rect.y / 20);
        const by = Math.round(b.rect.y / 20);
        if (ay !== by) return ay - by;
        return a.rect.x - b.rect.x;
      });
      return applyFocusedId(visible[0].id, `move-${direction}`);
    }

    const currentCenter = centerOf(current.rect);
    const scored = visible
      .filter((entry) => entry.id !== current.id)
      .map((entry) => {
        const c = centerOf(entry.rect);
        const dx = c.x - currentCenter.x;
        const dy = c.y - currentCenter.y;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        let valid = false;
        let primary = 0;
        let cross = 0;
        if (direction === 'right') {
          valid = dx > 12;
          primary = dx;
          cross = absDy;
        } else if (direction === 'left') {
          valid = dx < -12;
          primary = -dx;
          cross = absDy;
        } else if (direction === 'down') {
          valid = dy > 12;
          primary = dy;
          cross = absDx;
        } else if (direction === 'up') {
          valid = dy < -12;
          primary = -dy;
          cross = absDx;
        }

        if (!valid) return null;
        const sameBandBonus = cross < (direction === 'left' || direction === 'right' ? current.rect.height : current.rect.width) * 0.75 ? -180 : 0;
        return { ...entry, score: primary + cross * 2.6 + sameBandBonus };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score);

    if (!scored.length) return false;
    return applyFocusedId(scored[0].id, `move-${direction}`);
  }, [applyFocusedId, measureAllVisible]);

  const pressFocused = useCallback(() => {
    const currentTime = now();
    if (currentTime - lastSelectRef.current < 350) return true;
    lastSelectRef.current = currentTime;

    const id = focusedIdRef.current;
    const item = id ? registryRef.current.get(id) : null;
    if (item && !item.disabled && typeof item.onPress === 'function') {
      try {
        item.onPress();
        return true;
      } catch (_) {
        return false;
      }
    }
    return false;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (autoFocusTimerRef.current) clearTimeout(autoFocusTimerRef.current);
    };
  }, []);


  useEffect(() => {
    if (!isTV) return undefined;
    const sub = Dimensions.addEventListener?.('change', () => {
      setTimeout(() => {
        if (focusedIdRef.current) applyFocusedId(focusedIdRef.current, 'dimension-change');
        else chooseFirstVisible();
      }, 180);
    });
    return () => { try { sub?.remove?.(); } catch (_) {} };
  }, [applyFocusedId, chooseFirstVisible]);

  // RN TV 0.81 maneja el D-pad de forma nativa. Este contexto queda como helper
  // legacy para pantallas que aun lo consulten, pero no intercepta teclas.

  const value = useMemo(() => ({
    focusedId,
    cursorRect,
    registerFocusable,
    updateFocusable,
    setFocusedItem: applyFocusedId,
    refreshFocusedRect,
    moveFocus,
    pressFocused,
    isTVFocusEnabled: isTV,
  }), [
    focusedId,
    cursorRect,
    registerFocusable,
    updateFocusable,
    applyFocusedId,
    refreshFocusedRect,
    moveFocus,
    pressFocused,
  ]);

  return (
    <TVFocusContext.Provider value={value}>
      {children}
    </TVFocusContext.Provider>
  );
}

export function useTVFocus() {
  return useContext(TVFocusContext);
}
