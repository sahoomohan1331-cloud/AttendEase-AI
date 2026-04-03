import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing } from 'react-native';
import { colors } from '../styles';

interface SplashScreenProps {
  onFinish: () => void;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ onFinish }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.7)).current;
  const subtitleFade = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // 1. Logo fade in + scale
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // 2. Subtitle fade in
      Animated.timing(subtitleFade, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }).start();

      // 3. Pulse effect
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 1000,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.ease),
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.ease),
          }),
        ])
      ).start();
    });

    // Auto-dismiss after 2.5 seconds
    const timer = setTimeout(onFinish, 2500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={{
      flex: 1,
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center',
    }}>
      {/* Glow Effect */}
      <View style={{
        position: 'absolute',
        width: 200, height: 200, borderRadius: 100,
        backgroundColor: 'rgba(0, 209, 255, 0.08)',
      }} />

      {/* Logo */}
      <Animated.View style={{
        opacity: fadeAnim,
        transform: [{ scale: Animated.multiply(scaleAnim, pulseAnim) }],
        alignItems: 'center',
      }}>
        {/* Icon */}
        <View style={{
          width: 90, height: 90, borderRadius: 24,
          backgroundColor: 'rgba(0, 209, 255, 0.12)',
          justifyContent: 'center', alignItems: 'center',
          marginBottom: 24,
          borderWidth: 2, borderColor: 'rgba(0, 209, 255, 0.25)',
        }}>
          <Text style={{ fontSize: 42 }}>🎯</Text>
        </View>

        {/* Title */}
        <Text style={{
          fontSize: 38, fontWeight: '900',
          color: colors.primary,
          letterSpacing: 3,
        }}>
          ATTENDEASE
        </Text>
      </Animated.View>

      {/* Subtitle */}
      <Animated.View style={{ opacity: subtitleFade, marginTop: 12 }}>
        <Text style={{
          color: colors.textMuted, fontSize: 14,
          letterSpacing: 2,
        }}>
          AI-POWERED ATTENDANCE
        </Text>
      </Animated.View>

      {/* Version */}
      <Animated.View style={{
        opacity: subtitleFade,
        position: 'absolute', bottom: 50,
      }}>
        <Text style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>
          v3.0 — Engineering College Edition
        </Text>
      </Animated.View>
    </View>
  );
};

export default SplashScreen;
