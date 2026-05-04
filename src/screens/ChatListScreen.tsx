import React, { useState, useEffect, useCallback, useLayoutEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { useAuth } from '../hooks/useAuth';
import * as client from '../api/client';
import type { Session, Transcript } from '../types/api';

type ChatItem = {
  id: string;
  title: string;
  preview: string;
  timestamp: string;
  messageCount: number;
  isLive: boolean;
  busy: boolean;
  channel: string;
  source: 'active' | 'archived';
  filename?: string;
};

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

export function ChatListScreen({ navigation }: Props) {
  const { logout } = useAuth();
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadChats = useCallback(async () => {
    try {
      // Fetch active sessions and recent transcripts in parallel
      const [activeData, transcriptData] = await Promise.all([
        client.getActiveSessions(),
        client.getTranscripts({ excludeChannel: 'cron', limit: 30 }),
      ]);

      const items: ChatItem[] = [];

      // Active sessions first
      for (const s of activeData.sessions || []) {
        items.push({
          id: s.sessionId,
          title: s.sessionId.replace(/^web:|^tg:/, ''),
          preview: s.preview || '',
          timestamp: s.lastActive || s.startedAt,
          messageCount: s.messageCount,
          isLive: s.isLive,
          busy: s.busy,
          channel: s.channel,
          source: 'active',
        });
      }

      // Archived transcripts (skip any that match an active session)
      const activeIds = new Set(items.map((i) => i.id));
      for (const t of transcriptData.transcripts || []) {
        if (activeIds.has(t.sessionId)) continue;
        items.push({
          id: t.sessionId,
          title: t.sessionId.replace(/^web:|^tg:/, ''),
          preview: t.preview || '',
          timestamp: t.archivedAt || t.startedAt,
          messageCount: t.messageCount,
          isLive: false,
          busy: false,
          channel: t.channel,
          source: 'archived',
          filename: t.file,
        });
      }

      // Sort by most recent
      items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      setChats(items);
    } catch (e) {
      console.error('Failed to load chats:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  // Header logout button
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => {
            Alert.alert('Sign Out', 'Disconnect from Brain?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign Out', style: 'destructive', onPress: logout },
            ]);
          }}
          style={{ paddingHorizontal: 12 }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 14 }}>Sign Out</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, logout]);

  // Refresh when screen comes into focus
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadChats();
    });
    return unsubscribe;
  }, [navigation, loadChats]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadChats();
  }, [loadChats]);

  const openChat = (item: ChatItem) => {
    navigation.navigate('Chat', {
      sessionId: item.source === 'active' ? item.id : undefined,
      restoreFilename: item.source === 'archived' ? item.filename : undefined,
      title: item.title,
    });
  };

  const startNewChat = () => {
    navigation.navigate('Chat', {
      sessionId: undefined,
      title: 'New Chat',
    });
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString();
  };

  const channelIcon = (ch: string) => {
    switch (ch) {
      case 'web': return '🌐';
      case 'telegram': return '📱';
      case 'cron': return '⚙️';
      default: return '💬';
    }
  };

  const renderItem = ({ item }: { item: ChatItem }) => (
    <TouchableOpacity style={styles.chatItem} onPress={() => openChat(item)} activeOpacity={0.7}>
      <View style={styles.chatRow}>
        <Text style={styles.channelIcon}>{channelIcon(item.channel)}</Text>
        <View style={styles.chatInfo}>
          <View style={styles.chatHeader}>
            <Text style={styles.chatTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.chatTime}>{formatTime(item.timestamp)}</Text>
          </View>
          <Text style={styles.chatPreview} numberOfLines={2}>
            {item.preview || 'No messages yet'}
          </Text>
          <View style={styles.chatMeta}>
            <Text style={styles.chatCount}>{item.messageCount} msgs</Text>
            {item.busy && <View style={styles.busyDot} />}
            {item.isLive && <Text style={styles.liveBadge}>LIVE</Text>}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={chats}
        keyExtractor={(item, index) =>
          item.source === 'archived'
            ? `archived-${item.filename || `${item.id}-${index}`}`
            : `active-${item.id}`
        }
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
        contentContainerStyle={chats.length === 0 ? styles.center : undefined}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>{'\uD83D\uDCAC'}</Text>
            <Text style={styles.emptyText}>No conversations yet</Text>
            <Text style={styles.emptySubtext}>Start a new chat below</Text>
          </View>
        }
      />
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.newChatButton} onPress={startNewChat}>
          <Text style={styles.newChatText}>+ New Chat</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  channelIcon: {
    fontSize: 20,
    marginRight: 12,
    marginTop: 2,
  },
  chatInfo: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  chatTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  chatTime: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  chatPreview: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: 6,
  },
  chatMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatCount: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  busyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.warning,
  },
  liveBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.success,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: `${colors.success}20`,
    overflow: 'hidden',
  },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  bottomBar: {
    padding: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgSecondary,
  },
  newChatButton: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  newChatText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
