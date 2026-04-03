import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert, Image as RNImage } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import axios from 'axios';
import { colors, globalStyles } from '../styles';
import { ENDPOINTS } from '../config';

interface RegisterScreenProps {
  onBack: () => void;
}

const RegisterScreen: React.FC<RegisterScreenProps> = ({ onBack }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [studentId, setStudentId] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    if (!permission) {
        requestPermission();
    }
  }, [permission]);

  const takePhoto = async () => {
    if (cameraRef.current) {
      const photo = await cameraRef.current.takePictureAsync({ 
        quality: 0.7, 
        base64: true 
      });
      if (photo) {
        setCapturedImage(photo.uri);
      }
    }
  };

  const handleRegister = async () => {
    if (!studentId || !capturedImage) {
      Alert.alert("Error", "Please enter Student ID and capture a photo.");
      return;
    }

    setIsRegistering(true);
    try {
      const formData = new FormData();
      formData.append('student_id', studentId);
      
      const uriParts = capturedImage.split('.');
      const fileType = uriParts[uriParts.length - 1];
      
      // @ts-ignore: FormData is handled differently in React Native
      formData.append('file', {
        uri: capturedImage,
        name: `photo.${fileType}`,
        type: `image/${fileType}`,
      });

      const response = await axios.post(ENDPOINTS.REGISTER, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (response.data.status === 'success') {
        Alert.alert("Success", response.data.message);
        onBack();
      } else {
        Alert.alert("Error", response.data.error || "Failed to register.");
      }
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Could not connect to the backend server.");
    } finally {
      setIsRegistering(false);
    }
  };

  if (!permission) {
    return <View style={globalStyles.container}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (!permission.granted) {
    return (
        <View style={[globalStyles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
            <Text style={{ color: colors.text, textAlign: 'center', marginBottom: 20 }}>
                We need camera access to enroll students.
            </Text>
            <TouchableOpacity style={globalStyles.button} onPress={requestPermission}>
                <Text style={globalStyles.buttonText}>GRANT PERMISSION</Text>
            </TouchableOpacity>
        </View>
    );
  }

  return (
    <View style={globalStyles.container}>
      <View style={{ padding: 20 }}>
        <TouchableOpacity onPress={onBack}>
          <Text style={{ color: colors.primary, fontSize: 18, marginBottom: 10 }}>← Back</Text>
        </TouchableOpacity>
        <Text style={globalStyles.title}>ENROLL STUDENT</Text>
      </View>

      {!capturedImage ? (
        <View style={{ flex: 1, backgroundColor: 'black', overflow: 'hidden', borderRadius: 24, marginHorizontal: 20 }}>
          <CameraView 
            style={{ flex: 1 }} 
            facing="front" 
            ref={cameraRef} 
          />
          <TouchableOpacity 
            style={[globalStyles.button, { position: 'absolute', bottom: 20, left: 20, right: 20 }]} 
            onPress={takePhoto}
          >
            <Text style={globalStyles.buttonText}>SNAP PHOTO</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: 20 }}>
          <RNImage source={{ uri: capturedImage }} style={{ flex: 1, borderRadius: 24 }} />
          <TouchableOpacity 
            style={{ position: 'absolute', top: 10, right: 30, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }} 
            onPress={() => setCapturedImage(null)}
          >
            <Text style={{ color: 'white' }}>X</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={{ padding: 20 }}>
        <TextInput 
          style={[globalStyles.input,
            studentId.length > 0 && !/^\d{10}$/.test(studentId)
              ? { borderColor: colors.error, borderWidth: 2 }
              : studentId.length === 10 ? { borderColor: colors.success, borderWidth: 2 } : {}
          ]} 
          placeholder="10-digit Registration Number" 
          placeholderTextColor={colors.textMuted} 
          value={studentId}
          onChangeText={(t) => setStudentId(t.replace(/[^0-9]/g, '').slice(0, 10))}
          keyboardType="number-pad"
          maxLength={10}
        />
        <TouchableOpacity 
          style={[globalStyles.button, { opacity: isRegistering ? 0.5 : 1 }]} 
          onPress={handleRegister}
          disabled={isRegistering}
        >
          {isRegistering ? <ActivityIndicator color="black" /> : <Text style={globalStyles.buttonText}>REGISTER STUDENT</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default RegisterScreen;
