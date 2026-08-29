import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
} from 'expo-keep-awake';
import { Button, Card, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import ProgressPanel from '../components/ProgressPanel';
import { transcribeLongAudio } from '../services/whisperService';

const KEEP_AWAKE_TAG = 'audiencia-recording';
const PROCESSING_AWAKE_TAG = 'audiencia-transcription';

function formatDuration(milliseconds = 0) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

export default function HomeScreen({ navigation }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 500);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressState, setProgressState] = useState({
    status: '',
    progress: 0,
    currentPart: 0,
    totalParts: 0,
  });

  useEffect(() => {
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
      deactivateKeepAwake(PROCESSING_AWAKE_TAG).catch(() => undefined);
    };
  }, []);

  const processAudio = async (audio) => {
    setIsProcessing(true);
    setProgressState({
      status: 'Preparando audio...',
      progress: 0.01,
      currentPart: 0,
      totalParts: 0,
    });

    try {
      await activateKeepAwakeAsync(PROCESSING_AWAKE_TAG);
      const result = await transcribeLongAudio(audio, {
        onProgress: setProgressState,
      });
      setProgressState({
        status: 'Finalizado',
        progress: 1,
        currentPart: progressState.totalParts,
        totalParts: progressState.totalParts,
      });
      navigation.navigate('Resultados', result);
    } catch (error) {
      Alert.alert('No se pudo transcribir', error.message);
    } finally {
      await deactivateKeepAwake(PROCESSING_AWAKE_TAG).catch(() => undefined);
      setIsProcessing(false);
    }
  };

  const startRecording = async () => {
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Permiso necesario',
          'Debes permitir el uso del micrófono para iniciar una grabación.'
        );
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    } catch (error) {
      Alert.alert('No se pudo grabar', error.message);
    }
  };

  const stopRecording = async () => {
    try {
      await recorder.stop();
      await deactivateKeepAwake(KEEP_AWAKE_TAG);
      const uri = recorder.uri;
      if (!uri) {
        throw new Error('No se encontró el archivo de la grabación.');
      }

      await processAudio({
        uri,
        name: `audiencia-${new Date().toISOString().replace(/[:.]/g, '-')}.m4a`,
        mimeType: 'audio/mp4',
      });
    } catch (error) {
      Alert.alert('No se pudo guardar la grabación', error.message);
    }
  };

  const pickAudio = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        // PJUD y otros portales a veces guardan audios como
        // application/octet-stream. Mostrar todos los archivos evita que el
        // selector de Android los oculte aunque FFmpeg sí pueda leerlos.
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled) return;
      const asset = result.assets[0];
      await processAudio({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
      });
    } catch (error) {
      Alert.alert('No se pudo abrir el archivo', error.message);
    }
  };

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.heading}>
          <Text variant="headlineMedium" style={styles.title}>
            Convierte audiencias largas en texto
          </Text>
          <Text variant="bodyLarge" style={styles.subtitle}>
            Graba desde el teléfono o selecciona un audio guardado. La app lo
            divide y transcribe en el orden correcto.
          </Text>
        </View>

        {recorderState.isRecording ? (
          <Card mode="contained" style={styles.recordingCard}>
            <Card.Content style={styles.recordingContent}>
              <View style={styles.recordingDot} />
              <View>
                <Text variant="titleMedium">Grabando audiencia</Text>
                <Text variant="headlineSmall" style={styles.timer}>
                  {formatDuration(recorderState.durationMillis)}
                </Text>
              </View>
            </Card.Content>
          </Card>
        ) : null}

        <Button
          mode="contained"
          icon={recorderState.isRecording ? 'stop-circle' : 'microphone'}
          contentStyle={styles.primaryButtonContent}
          labelStyle={styles.primaryButtonLabel}
          disabled={isProcessing}
          onPress={recorderState.isRecording ? stopRecording : startRecording}
          buttonColor={recorderState.isRecording ? '#A62C2B' : '#14213A'}
        >
          {recorderState.isRecording
            ? 'Detener y transcribir'
            : 'Iniciar Grabación'}
        </Button>

        <Button
          mode="outlined"
          icon="file-music-outline"
          contentStyle={styles.secondaryButtonContent}
          labelStyle={styles.secondaryButtonLabel}
          disabled={isProcessing || recorderState.isRecording}
          onPress={pickAudio}
          style={styles.secondaryButton}
        >
          Subir Archivo de Audio
        </Button>

        {isProcessing ? <ProgressPanel {...progressState} /> : null}

        <Card mode="outlined" style={styles.noteCard}>
          <Card.Content>
            <Text variant="titleSmall">Diseñada para audios extensos</Text>
            <Text variant="bodyMedium" style={styles.noteText}>
              Transcripción gratuita en el teléfono, sin API ni clave. Mantén
              Termux abierto. Un audio largo puede tardar y consumir bastante
              batería; comienza probando 30 segundos.
            </Text>
          </Card.Content>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F3EC',
  },
  container: {
    flexGrow: 1,
    padding: 22,
    paddingTop: 28,
  },
  heading: {
    marginBottom: 30,
  },
  title: {
    color: '#14213A',
    fontWeight: '800',
    lineHeight: 36,
  },
  subtitle: {
    color: '#5E574B',
    lineHeight: 24,
    marginTop: 10,
  },
  recordingCard: {
    backgroundColor: '#F5DFDD',
    marginBottom: 18,
  },
  recordingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  recordingDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#A62C2B',
  },
  timer: {
    color: '#6A1C1C',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  primaryButtonContent: {
    minHeight: 72,
  },
  primaryButtonLabel: {
    fontSize: 18,
    fontWeight: '800',
  },
  secondaryButton: {
    marginTop: 14,
    borderColor: '#14213A',
  },
  secondaryButtonContent: {
    minHeight: 62,
  },
  secondaryButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  noteCard: {
    backgroundColor: '#FFFDF9',
    marginTop: 28,
  },
  noteText: {
    color: '#5E574B',
    lineHeight: 21,
    marginTop: 6,
  },
});
