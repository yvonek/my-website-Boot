import { Badge, Button, Card, MessageBar, MessageBarBody, Text, Title1 } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { UserMessage } from '../api/types';

export function UserMessagesPage() {
  const [messages, setMessages] = useState<UserMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState('');
  const [busyMessage, setBusyMessage] = useState('');

  const loadMessages = async () => {
    try {
      const result = await api.getUserMessages();
      setMessages(result.messages);
      setUnreadCount(result.unreadCount);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Messages could not be loaded.');
    }
  };

  useEffect(() => {
    void loadMessages();
    const timer = window.setInterval(() => void loadMessages(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const markRead = async (message: UserMessage) => {
    if (message.isRead) return;
    setBusyMessage(message.id);
    try {
      await api.markUserMessageRead(message.id);
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, isRead: true } : item));
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Message could not be marked as read.');
    } finally {
      setBusyMessage('');
    }
  };

  return <div className="page-stack user-messages-page"><div className="page-intro"><Text className="hero-eyebrow">Inbox · {unreadCount} unread</Text><Title1>Messages</Title1><Text className="muted">Private messages and announcements for your account.</Text><Button appearance="secondary" as="a" href="/support">Message support</Button></div>{error && <MessageBar intent="error"><MessageBarBody>{error}<Button appearance="transparent" onClick={() => void loadMessages()}>Retry</Button></MessageBarBody></MessageBar>}{messages.length ? <div className="user-message-list">{messages.map((message) => <Card className={message.isRead ? 'user-message' : 'user-message is-unread'} key={message.id}><div className="user-message__top"><Badge color={message.notificationType === 'WARNING' ? 'warning' : message.notificationType === 'SUCCESS' ? 'success' : 'informative'}>{message.kind === 'BROADCAST' ? 'Announcement' : 'Private'}</Badge><time>{new Date(message.createdAt).toLocaleString()}</time></div>{message.title && <strong className="user-message__title">{message.title}</strong>}<Text className="user-message__body">{message.body}</Text><div className="user-message__footer"><span>From {message.senderName ?? 'Admin'}</span><div>{!message.isRead && <Button appearance="secondary" disabled={busyMessage === message.id} onClick={() => void markRead(message)}>{busyMessage === message.id ? 'Saving...' : 'Mark as read'}</Button>}<Button appearance="subtle" as="a" href="/support">Reply</Button></div></div></Card>)}</div> : !error && <Card className="user-messages-empty"><strong>No messages yet</strong><Text>Admin messages and announcements will appear here.</Text><Button appearance="secondary" as="a" href="/support">Start a conversation</Button></Card>}</div>;
}
