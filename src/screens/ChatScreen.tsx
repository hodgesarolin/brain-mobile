import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import * as client from '../api/client';
import type { ChatStreamEvent } from '../types/api';

type RouteParams = {
  Chat: {
    sessionId?: string;
    restoreFilename?: string;
    title?: string;
  };
};

type Props = NativeStackScreenProps<RouteParams, 'Chat'>;

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  tools?: string[];
}

export function ChatScreen({ route, navigation }: Props) {
  const { sessionId: initialSessionId, restoreFilename, title } = route.params;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>(initialSessionId);
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const msgIdCounter = useRef(0);

  const nextId = () => `msg_${++msgIdCounter.current}`;

  // Load existing session or restore from transcript
  useEffect(() => {
    let cancelled = false;

    const loadMessages = async (sid: string) => {
      const data = await client.getSessionMessages(sid);
      if (cancelled) return;
      if (data?.messages) {
        const loaded: ChatMessage[] = data.messages.map((m: any, i: number) => ({
          id: `loaded_${i}`,
          role: m.role,
          content: typeof m.content === 'string'
            ? m.content
            : Array.isArray(m.content)
              ? m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
              : '',
        }));
        setMessages(loaded);
      }
    };

    (async () => {
      setLoading(true);
      try {
        if (restoreFilename) {
          const data = await client.restoreSession(restoreFilename);
          if (cancelled) return;
          const restoredId = data.sessionId;
          setSessionId(restoredId);
          await loadMessages(restoredId);
        } else if (initialSessionId) {
          await loadMessages(initialSessionId);
        }
      } catch (e) {
        if (!cancelled) console.error('Failed to load session:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [initialSessionId, restoreFilename]);

  // Update nav title with session info
  useEffect(() => {
    navigation.setOptions({
      title: title || sessionId || 'Chat',
    });
  }, [title, sessionId, navigation]);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, []);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: ChatMessage = { id: nextId(), role: 'user', content: text };
    const assistantMsg: ChatMessage = { id: nextId(), role: 'assistant', content: '', isStreaming: true, tools: [] };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);
    scrollToEnd();

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      await client.streamChat(
        text,
        sessionId,
        (event: ChatStreamEvent) => {
          switch (event.type) {
            case 'text_delta':
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: last.content + (event.delta || '') };
                }
                return updated;
              });
              scrollToEnd();
              break;

            case 'tool_start':
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === 'assistant' && last.tools) {
                  updated[updated.length - 1] = { ...last, tools: [...last.tools, event.name || 'tool'] };
                }
                return updated;
              });
              break;

            case 'done':
              if (event.sessionId) {
                setSessionId(event.sessionId);
              }
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === 'assistant') {
                  updated[updated.length - 1] = {
                    ...last,
                    isStreaming: false,
                    content: (event.text && !last.content) ? event.text : last.content,
                  };
                }
                return updated;
              });
              break;

            case 'turn_complete':
              // Multi-turn: Brain may do another turn
              if (event.text) {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, content: event.text || last.content };
                  }
                  return updated;
                });
              }
              scrollToEnd();
              break;

            case 'error':
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === 'assistant') {
                  updated[updated.length - 1] = {
                    ...last,
                    content: `Error: ${event.message || 'Unknown error'}`,
                    isStreaming: false,
                  };
                }
                return updated;
              });
              break;
          }
        },
        { signal: abort.signal },
      );
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === 'assistant') {
            updated[updated.length - 1] = {
              ...last,
              content: `Error: ${e.message}`,
              isStreaming: false,
            };
          }
          return updated;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleAbort = async () => {
    // Abort both the local XHR and the server-side query
    abortRef.current?.abort();
    if (sessionId) {
      try {
        await client.abortChat(sessionId);
      } catch {
        // Best-effort
      }
    }
    setStreaming(false);
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role === 'assistant' && last.isStreaming) {
        updated[updated.length - 1] = {
          ...last,
          isStreaming: false,
          content: last.content || '[Stopped]',
        };
      }
      return updated;
    });
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        {!isUser && item.tools && item.tools.length > 0 && (
          <View style={styles.toolBar}>
            {item.tools.map((t, i) => (
              <Text key={i} style={styles.toolBadge}>🔧 {t}</Text>
            ))}
          </View>
        )}
        <Text style={[styles.messageText, isUser && styles.userText]} selectable>
          {item.content || (item.isStreaming ? '' : '[empty]')}
        </Text>
        {item.isStreaming && (
          <ActivityIndicator
            size="small"
            color={colors.accent}
            style={styles.streamingIndicator}
          />
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={scrollToEnd}
        ListEmptyComponent={
          <View style={styles.welcome}>
            <Text style={styles.welcomeEmoji}>🧠</Text>
            <Text style={styles.welcomeTitle}>Brain</Text>
            <Text style={styles.welcomeSubtitle}>Your personal AI assistant with memory</Text>
          </View>
        }
      />

      <View style={styles.inputArea}>
        <TextInput
          style={styles.input}
          placeholder="Message Brain..."
          placeholderTextColor={colors.textSecondary}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={10000}
          returnKeyType="default"
          editable={!streaming}
        />
        {streaming ? (
          <TouchableOpacity style={styles.stopButton} onPress={handleAbort}>
            <Text style={styles.stopText}>Stop</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.sendButton, !input.trim() && styles.sendDisabled]}
            onPress={sendMessage}
            disabled={!input.trim()}
          >
            <Text style={styles.sendText}>Send</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageList: {
    padding: 16,
    paddingBottom: 8,
    flexGrow: 1,
  },
  welcome: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 120,
  },
  welcomeEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  welcomeSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  messageBubble: {
    maxWidth: '85%',
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
  },
  userBubble: {
    backgroundColor: colors.userBg,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: colors.assistantBg,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageText: {
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  userText: {
    color: '#fff',
  },
  toolBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 8,
  },
  toolBadge: {
    fontSize: 11,
    color: colors.textSecondary,
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  streamingIndicator: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  inputArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgSecondary,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    color: colors.textPrimary,
    fontSize: 15,
    maxHeight: 120,
    minHeight: 42,
  },
  sendButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  sendDisabled: {
    opacity: 0.4,
  },
  sendText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  stopButton: {
    backgroundColor: colors.error,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  stopText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
});
