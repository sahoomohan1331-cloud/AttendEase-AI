import React from 'react';
import { View, Text, TouchableOpacity, Linking, Image, Alert } from 'react-native';
import { colors, globalStyles } from '../styles';

interface UpdateScreenProps {
  latestVersion: string;
  updateUrl: string;
  isMandatory: boolean;
  onDismiss?: () => void;
}

const UpdateScreen: React.FC<UpdateScreenProps> = ({ 
  latestVersion, 
  updateUrl, 
  isMandatory,
  onDismiss 
}) => {
  const handleUpdate = async () => {
    try {
      const supported = await Linking.canOpenURL(updateUrl);
      if (supported) {
        await Linking.openURL(updateUrl);
      } else {
        Alert.alert('Error', 'Could not open the update link automatically.');
      }
    } catch (err) {
      Alert.alert('Error', 'Something went wrong while opening the link.');
    }
  };

  return (
    <View style={[globalStyles.container, { justifyContent: 'center', alignItems: 'center', padding: 30 }]}>
      {/* Update Icon/Illustration */}
      <View style={{
        width: 120, height: 120, borderRadius: 60,
        backgroundColor: 'rgba(0, 209, 255, 0.1)',
        justifyContent: 'center', alignItems: 'center',
        marginBottom: 30,
        borderWidth: 2, borderColor: colors.primary,
      }}>
        <Text style={{ fontSize: 60 }}>🚀</Text>
      </View>

      <Text style={{
        color: colors.text, fontSize: 28, fontWeight: '900',
        textAlign: 'center', marginBottom: 12,
      }}>
        UPDATE AVAILABLE
      </Text>

      <View style={{ 
        backgroundColor: 'rgba(255, 184, 0, 0.15)', 
        paddingHorizontal: 12, paddingVertical: 6, 
        borderRadius: 8, marginBottom: 20 
      }}>
        <Text style={{ color: '#FFB800', fontWeight: '800', fontSize: 13 }}>
          VERSION v{latestVersion} READY
        </Text>
      </View>

      <Text style={{
        color: colors.textMuted, fontSize: 16,
        textAlign: 'center', lineHeight: 24, marginBottom: 40,
        paddingHorizontal: 10,
      }}>
        A new version of AttendEase AI is ready! We've made improvements to performance and security.
      </Text>

      <TouchableOpacity
        style={[globalStyles.button, { width: '100%', marginBottom: 15 }]}
        onPress={handleUpdate}
      >
        <Text style={globalStyles.buttonText}>GET UPDATE NOW</Text>
      </TouchableOpacity>

      {!isMandatory && onDismiss && (
        <TouchableOpacity
          style={{ padding: 10 }}
          onPress={onDismiss}
        >
          <Text style={{ color: colors.textMuted, fontSize: 14 }}>SKIP FOR NOW</Text>
        </TouchableOpacity>
      )}

      {isMandatory && (
        <Text style={{ color: colors.error, fontSize: 12, marginTop: 10, opacity: 0.7 }}>
          * This is a mandatory security update
        </Text>
      )}
    </View>
  );
};

export default UpdateScreen;
