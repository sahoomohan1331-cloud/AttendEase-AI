import { StyleSheet } from 'react-native';

// Professional 2026 Dark Mode / Glassmorphism Palette
export const colors = {
  background: '#0D0E15',      // Deep space black
  cardBackground: '#1C1F2E',  // Elevated surface
  primary: '#00D1FF',         // Neon Cyan (Action)
  secondary: '#FF0055',       // Neon Pink (Alert/Secondary)
  text: '#FFFFFF',
  textMuted: '#8F9BB3',
  success: '#00E096',
  error: '#FF3D71',
  glassOverlay: 'rgba(28, 31, 46, 0.65)',
};

export const globalStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 28,
    fontFamily: 'sans-serif-medium',
    color: colors.text,
    textAlign: 'center',
    marginVertical: 20,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 30,
    paddingHorizontal: 20,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 10,
    elevation: 5,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  buttonText: {
    color: '#000000',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: 24,
    padding: 24,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    color: colors.text,
    height: 56,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 20,
  }
});
