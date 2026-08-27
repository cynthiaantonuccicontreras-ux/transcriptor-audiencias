import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button, Card, Searchbar, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function HighlightedTranscript({ text, query }) {
  const fragments = useMemo(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [text];
    return text.split(new RegExp(`(${escapeRegExp(trimmedQuery)})`, 'gi'));
  }, [query, text]);

  const normalizedQuery = query.trim().toLocaleLowerCase('es');

  return (
    <Text selectable variant="bodyLarge" style={styles.transcriptText}>
      {fragments.map((fragment, index) => {
        const isMatch =
          normalizedQuery &&
          fragment.toLocaleLowerCase('es') === normalizedQuery;
        return (
          <Text key={`${index}-${fragment.slice(0, 8)}`} style={isMatch ? styles.match : null}>
            {fragment}
          </Text>
        );
      })}
    </Text>
  );
}

export default function ResultsScreen({ route }) {
  const { text = '', fileName = 'Audio transcrito' } = route.params || {};
  const [query, setQuery] = useState('');

  const matchCount = useMemo(() => {
    const value = query.trim();
    if (!value) return 0;
    return (text.match(new RegExp(escapeRegExp(value), 'gi')) || []).length;
  }, [query, text]);

  const copyTranscript = async () => {
    await Clipboard.setStringAsync(text);
    Alert.alert('Texto copiado', 'La transcripción completa está en el portapapeles.');
  };

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <View style={styles.container}>
        <Text variant="titleMedium" numberOfLines={2} style={styles.fileName}>
          {fileName}
        </Text>

        <Searchbar
          placeholder="Buscar palabra o frase"
          value={query}
          onChangeText={setQuery}
          style={styles.searchbar}
          inputStyle={styles.searchInput}
        />
        <Text variant="labelMedium" style={styles.matchCount}>
          {query.trim()
            ? `${matchCount} coincidencia${matchCount === 1 ? '' : 's'}`
            : 'Escribe una palabra para destacarla en el texto'}
        </Text>

        <Card mode="outlined" style={styles.transcriptCard}>
          <ScrollView contentContainerStyle={styles.transcriptContent}>
            <HighlightedTranscript text={text} query={query} />
          </ScrollView>
        </Card>

        <Button
          mode="contained"
          icon="content-copy"
          onPress={copyTranscript}
          contentStyle={styles.copyButtonContent}
          labelStyle={styles.copyButtonLabel}
        >
          Copiar al portapapeles
        </Button>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F3EC',
  },
  container: {
    flex: 1,
    padding: 18,
  },
  fileName: {
    color: '#14213A',
    fontWeight: '700',
    marginBottom: 12,
  },
  searchbar: {
    backgroundColor: '#FFFFFF',
  },
  searchInput: {
    minHeight: 0,
  },
  matchCount: {
    color: '#685F51',
    marginTop: 7,
    marginLeft: 4,
  },
  transcriptCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    marginVertical: 14,
  },
  transcriptContent: {
    padding: 18,
  },
  transcriptText: {
    color: '#27231D',
    lineHeight: 27,
  },
  match: {
    backgroundColor: '#F4D87A',
    color: '#14213A',
    fontWeight: '700',
  },
  copyButtonContent: {
    minHeight: 54,
  },
  copyButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
});
