import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { colors, globalStyles } from '../styles';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('🔴 ErrorBoundary caught:', error, errorInfo);
  }

  handleRestart = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={[globalStyles.container, {
          justifyContent: 'center', alignItems: 'center', padding: 30,
        }]}>
          {/* Icon */}
          <View style={{
            width: 80, height: 80, borderRadius: 40,
            backgroundColor: 'rgba(255, 61, 113, 0.1)',
            justifyContent: 'center', alignItems: 'center',
            marginBottom: 24,
            borderWidth: 2, borderColor: 'rgba(255, 61, 113, 0.2)',
          }}>
            <Text style={{ fontSize: 36 }}>⚠️</Text>
          </View>

          <Text style={{
            color: colors.text, fontSize: 22, fontWeight: '800',
            textAlign: 'center', marginBottom: 12,
          }}>
            Something Went Wrong
          </Text>

          <Text style={{
            color: colors.textMuted, fontSize: 14,
            textAlign: 'center', lineHeight: 22, marginBottom: 24,
          }}>
            The app encountered an unexpected error. Tap below to restart.
          </Text>

          {/* Error Details */}
          <ScrollView style={{
            maxHeight: 120, width: '100%',
            backgroundColor: 'rgba(255,255,255,0.03)',
            borderRadius: 12, padding: 12, marginBottom: 24,
          }}>
            <Text style={{ color: colors.error, fontSize: 11, fontFamily: 'monospace' }}>
              {this.state.error?.message || 'Unknown error'}
            </Text>
          </ScrollView>

          <TouchableOpacity style={globalStyles.button} onPress={this.handleRestart}>
            <Text style={globalStyles.buttonText}>↻ RESTART APP</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
