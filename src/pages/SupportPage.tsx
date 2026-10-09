import { Button, Card, Field, Input, MessageBar, MessageBarBody, Text, Title1 } from '@fluentui/react-components';
import { ChatRegular, MailRegular, SendRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { SupportSettings } from '../api/types';

export function SupportPage({ allowTelegram = true }: { allowTelegram?: boolean }) {
  const [settings, setSettings] = useState<SupportSettings | null>(null);
  const [userId, setUserId] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<{ id: string; authorId: string; body: string; createdAt: string }[]>([]);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/support/settings').then((response) => response.json()).then(setSettings).catch(() => setError('Support settings are unavailable.'));
    api.getCurrentUser().then(({ user }) => setUserId(user?.id ?? '')).catch(() => undefined);
  }, []);
  const openChat = async () => {
    setConversationBusy(true);
    setError('');
    try {
      const existingResponse = await fetch('/api/support/conversations');
      const existingBody = await existingResponse.json();
      if (!existingResponse.ok) throw new Error(existingBody.error ?? 'Conversations could not be loaded.');
      const openConversation = existingBody.conversations?.find((item: { status: string }) => item.status === 'OPEN');
      if (openConversation) setConversationId(openConversation.id);
      else {
        const response = await fetch('/api/support/conversations', { method: 'POST' });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Conversation could not be opened.');
        setConversationId(body.conversation.id);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Conversation could not be opened.');
    } finally {
      setConversationBusy(false);
    }
  };

  useEffect(() => {
    if (!conversationId) return;
    let active = true;
    const loadConversationMessages = async () => {
      try {
        const response = await fetch(`/api/support/conversations/${encodeURIComponent(conversationId)}/messages`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Conversation messages could not be loaded.');
        if (active) setMessages(body.messages);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Conversation messages could not be loaded.');
      }
    };
    void loadConversationMessages();
    const timer = window.setInterval(() => void loadConversationMessages(), 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [conversationId]);

  const send = async () => {
    if (!conversationId || !message.trim()) return;
    setConversationBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/support/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: message.trim() }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Message could not be sent.');
      setMessages((current) => [...current, body.message]);
      setMessage('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Message could not be sent.');
    } finally {
      setConversationBusy(false);
    }
  };

  return <div className="page-stack support-page"><div className="page-intro"><Text className="hero-eyebrow">Customer care</Text><Title1>Support</Title1><Text className="muted">Need help? Contact the team through your preferred channel.</Text></div>{error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}<div className="support-grid">{allowTelegram && <Card className="support-card"><SendRegular /><strong>Telegram</strong><Text className="muted">Contact us on Telegram</Text>{settings?.telegramUrl && <Button as="a" href={settings.telegramUrl} target="_blank">Open Telegram</Button>}</Card>}<Card className="support-card"><MailRegular /><strong>Email</strong><Text className="muted">Send us an email</Text>{settings?.supportEmail && <Button as="a" href={`mailto:${settings.supportEmail}`}>Email support</Button>}</Card><Card className="support-card"><ChatRegular /><strong>Live Chat</strong><Text className="muted">Chat with support</Text><Button disabled={conversationBusy} onClick={() => void openChat()}>{conversationId ? 'Resume conversation' : 'Open conversation'}</Button></Card></div>{conversationId && <Card className="chat-card"><Title1>Live Chat</Title1><div className="chat-messages">{messages.map((item) => <div className={item.authorId === userId ? 'chat-message is-user' : 'chat-message is-support'} key={item.id}><Text>{item.body}</Text><small>{item.authorId === userId ? 'You' : 'Support'} · {new Date(item.createdAt).toLocaleString()}</small></div>)}</div><Field label="Message"><Input value={message} onChange={(_: unknown, data: { value: string }) => setMessage(data.value)} placeholder="Write a message" /><Button appearance="primary" disabled={conversationBusy || !message.trim()} onClick={() => void send()}>{conversationBusy ? 'Sending...' : 'Send message'}</Button></Field></Card>}</div>;
}
