import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MD3LightTheme, PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import HomeScreen from './src/screens/HomeScreen';
import ResultsScreen from './src/screens/ResultsScreen';

const Stack = createNativeStackNavigator();

const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#14213A',
    onPrimary: '#FFFFFF',
    secondary: '#C9A24A',
    onSecondary: '#14213A',
    background: '#F7F3EC',
    surface: '#FFFFFF',
    surfaceVariant: '#EDE5D8',
    outline: '#837765',
    error: '#B3261E',
  },
  roundness: 4,
};

export default function App() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <StatusBar style="light" backgroundColor="#14213A" />
        <NavigationContainer>
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: '#14213A' },
              headerTintColor: '#FFFFFF',
              headerTitleStyle: { fontWeight: '700' },
              contentStyle: { backgroundColor: '#F7F3EC' },
            }}
          >
            <Stack.Screen
              name="Inicio"
              component={HomeScreen}
              options={{ title: 'Transcriptor de Audiencias' }}
            />
            <Stack.Screen
              name="Resultados"
              component={ResultsScreen}
              options={{ title: 'Transcripción' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
