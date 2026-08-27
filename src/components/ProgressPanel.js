import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Card, ProgressBar, Text } from 'react-native-paper';

export default function ProgressPanel({ status, progress, currentPart, totalParts }) {
  const percentage = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <Card style={styles.card} mode="elevated">
      <Card.Content>
        <View style={styles.row}>
          <ActivityIndicator size={22} />
          <View style={styles.copy}>
            <Text variant="titleMedium">{status}</Text>
            {totalParts > 0 ? (
              <Text variant="bodySmall" style={styles.detail}>
                Parte {currentPart} de {totalParts}
              </Text>
            ) : null}
          </View>
          <Text variant="labelLarge">{percentage}%</Text>
        </View>
        <ProgressBar progress={progress} style={styles.bar} />
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 22,
    backgroundColor: '#FFFFFF',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  copy: {
    flex: 1,
  },
  detail: {
    color: '#685F51',
    marginTop: 2,
  },
  bar: {
    height: 8,
    borderRadius: 4,
    marginTop: 16,
  },
});
