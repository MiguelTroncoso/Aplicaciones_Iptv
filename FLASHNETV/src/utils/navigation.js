import { BackHandler } from 'react-native';
import { CommonActions, useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';

/**
 * resetInsideApp
 * Mantiene la navegacion dentro de FLASHNETV aunque Android haya quedado con un stack vacio.
 */
export const resetInsideApp = (navigation, routeName = 'Home', params = undefined) => {
  const tabRoutes = new Set(['Home', 'LiveTV', 'Movies', 'Series', 'Search', 'MainTabs']);

  // Pantallas que viven dentro del Bottom Tab Navigator.
  // No se pueden pushear como Stack.Screen porque no existen a nivel raíz.
  if (tabRoutes.has(routeName || 'Home')) {
    const screen = routeName && routeName !== 'MainTabs' ? routeName : 'Home';
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'MainTabs', params: { screen } }],
      })
    );
    return;
  }

  const routes = [{ name: 'MainTabs', params: { screen: 'Home' } }];
  if (routeName) routes.push(params ? { name: routeName, params } : { name: routeName });

  navigation.dispatch(
    CommonActions.reset({
      index: routes.length - 1,
      routes,
    })
  );
};

/**
 * safeBack
 * Evita el bug recurrente: navigation.goBack() puede cerrar la Activity si el stack nativo
 * quedó vacío o si Android llega primero al comportamiento por defecto.
 */
export const safeBack = (navigation, fallbackRoute = 'Home', fallbackParams = undefined) => {
  // Primero respeta el historial real de React Navigation.
  // Esto evita que una pantalla abierta desde Buscar / Favoritos / Continuar viendo
  // vuelva siempre a Home y pierda el contexto anterior.
  try {
    if (typeof navigation?.canGoBack === 'function' && navigation.canGoBack()) {
      navigation.goBack();
      return true;
    }
  } catch (_) {}

  // Si no hay historial, reconstruimos un stack interno seguro para que Android/TV
  // no cierre la Activity de la app al presionar volver.
  try {
    resetInsideApp(navigation, fallbackRoute || 'Home', fallbackParams);
    return true;
  } catch (_) {
    try { navigation.navigate(fallbackRoute || 'MainTabs', fallbackParams); }
    catch (__) { try { navigation.navigate('MainTabs'); } catch (___) {} }
    return true;
  }
};

/**
 * useSafeHardwareBack
 * Para pantallas distintas a Home. Intercepta el botón físico/regresar del celular o control TV.
 */
export const useSafeHardwareBack = (navigation, fallbackRoute = 'Home', fallbackParams = undefined) => {
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        safeBack(navigation, fallbackRoute, fallbackParams);
        return true;
      });
      return () => sub.remove();
    }, [navigation, fallbackRoute, fallbackParams])
  );
};

export const useFilterAwareHardwareBack = (
  navigation,
  hasFilter,
  clearFilter,
  fallbackRoute = 'Home',
  fallbackParams = undefined
) => {
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (hasFilter) {
          clearFilter?.();
          return true;
        }
        safeBack(navigation, fallbackRoute, fallbackParams);
        return true;
      });
      return () => sub.remove();
    }, [navigation, hasFilter, clearFilter, fallbackRoute, fallbackParams])
  );
};
