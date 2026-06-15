import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

const LOGO = require('../../assets/logo.png');

const SIZES = {
  nav: { width: 156, height: 46 },
  header: { width: 280, height: 82 },
  login: { width: 330, height: 98 },
  profile: { width: 260, height: 78 },
  lock: { width: 220, height: 66 },
  screensaver: { width: 520, height: 156 },
};

export default function BrandLogo({ variant = 'header', style, centered = false }) {
  const size = SIZES[variant] || SIZES.header;

  return (
    <View style={[styles.wrap, centered && styles.centered, style]}>
      <Image
        source={LOGO}
        resizeMode="contain"
        style={[styles.logo, { width: size.width, height: size.height }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    maxWidth: '100%',
  },
  centered: {
    alignItems: 'center',
  },
  logo: {
    maxWidth: '100%',
  },
});
