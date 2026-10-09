import { Button, Card, Field, Input, MessageBar, MessageBarBody, Text, Textarea, Title1 } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';

interface SupportConversation { id: string; user_id: string; status: 'OPEN' | 'RESOLVED'; updated_at: string; }
interface SupportMessage { id: string; authorId: string; body: string; createdAt: string; }

export function AdminMessagesPage() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [notificationType, setNotificationType] = useState<'INFO' | 'SUCCESS' | 'WARNING'>('INFO');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [conversations, setConversations] = useState<SupportConversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<SupportConversation | null>(null);
  const [conversationMessages, setConversationMessages] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState('');
  const [inboxError, setInboxError] = useState('');
  const [inboxBusy, setInboxBusy] = useState(false);

  const loadConversations = async () => {
    try {
      const response = await fetch('/api/admin/support/conversations');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Support conversations could not be loaded.');
      setConversations(result.conversations);
      setInboxError('');
    } catch (error) {
      setInboxError(error instanceof Error ? error.message : 'Support conversations could not be loaded.');
    }
  };

  const loadConversationMessages = async (conversation: SupportConversation) => {
    setSelectedConversation(conversation);
    setInboxBusy(true);
    try {
      const response = await fetch(`/api/admin/support/conversations/${encodeURIComponent(conversation.id)}/messages`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Conversation could not be loaded.');
      setConversationMessages(result.messages);
      setInboxError('');
    } catch (error) {
      setInboxError(error instanceof Error ? error.message : 'Conversation could not be loaded.');
    } finally {
      setInboxBusy(false);
    }
  };

  const sendReply = async () => {
    if (!selectedConversation || !reply.trim()) return;
    setInboxBusy(true);
    setInboxError('');
    try {
      const response = await fetch(`/api/admin/support/conversations/${encodeURIComponent(selectedConversation.id)}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: reply.trim() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Reply could not be sent.');
      setConversationMessages((current) => [...current, result.message]);
      setReply('');
      await loadConversations();
    } catch (error) {
      setInboxError(error instanceof Error ? error.message : 'Reply could not be sent.');
    } finally {
      setInboxBusy(false);
    }
  };

  useEffect(() => { void loadConversations(); }, []);
  useEffect(() => {
    if (!selectedConversation) return;
    const timer = window.setInterval(() => void loadConversationMessages(selectedConversation), 15000);
    return () => window.clearInterval(timer);
  }, [selectedConversation]);

  const broadcast = async () => {
    if (!body.trim() || !window.confirm('Send this broadcast to all eligible users?')) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/messages/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body: body.trim(), notificationType }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Broadcast could not be sent.');
      setTitle('');
      setBody('');
      setMessage('Broadcast delivered to the user inboxes.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Broadcast could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="admin-console-section admin-console-section--messages">
    <div className="admin-console-heading"><div><Text className="home-kicker">COMMUNICATIONS</Text><Title1>Messages</Title1></div></div>
    {message && <MessageBar intent={message.startsWith('Broadcast delivered') ? 'success' : 'error'}><MessageBarBody>{message}</MessageBarBody></MessageBar>}
    <Card className="admin-broadcast-form"><div><h2>Broadcast message</h2><p>Send one announcement to all eligible user inboxes. Read status is tracked per user.</p></div><Field label="Title (optional)"><Input value={title} onChange={(_: ChangeEvent<HTMLInputElement>, value: { value: string }) => setTitle(value.value)} placeholder="Announcement title" /></Field><Field label="Notification type"><select value={notificationType} onChange={(event) => setNotificationType(event.currentTarget.value as typeof notificationType)}><option value="INFO">Information</option><option value="SUCCESS">Success</option><option value="WARNING">Warning</option></select></Field><Field label="Message"><Textarea resize="vertical" rows={5} value={body} onChange={(_: ChangeEvent<HTMLTextAreaElement>, value: { value: string }) => setBody(value.value)} placeholder="Write the message for users" /></Field><Button appearance="primary" disabled={busy || !body.trim()} onClick={() => void broadcast()}>{busy ? 'Sending...' : 'Send broadcast'}</Button></Card>
    <section className="admin-support-inbox"><div className="admin-support-inbox__heading"><div><Text className="home-kicker">DIRECT SUPPORT</Text><h2>Conversations</h2></div><Button appearance="secondary" onClick={() => void loadConversations()}>Refresh</Button></div>
      {inboxError && <MessageBar intent="error"><MessageBarBody>{inboxError}</MessageBarBody></MessageBar>}
      <div className="admin-support-inbox__layout"><div className="admin-support-inbox__list">{conversations.length ? conversations.map((conversation) => <button type="button" className={selectedConversation?.id === conversation.id ? 'is-selected' : ''} key={conversation.id} onClick={() => void loadConversationMessages(conversation)}><strong>User {conversation.user_id.slice(-8)}</strong><span>{conversation.status} · {new Date(conversation.updated_at).toLocaleString()}</span></button>) : <Text className="muted">No support conversations yet.</Text>}</div>
        <div className="admin-support-inbox__thread">{selectedConversation ? <><div className="admin-support-inbox__messages">{conversationMessages.map((item) => <div className={item.authorId === selectedConversation.user_id ? 'admin-support-message is-user' : 'admin-support-message is-admin'} key={item.id}><Text>{item.body}</Text><small>{item.authorId === selectedConversation.user_id ? 'User' : 'Admin'} · {new Date(item.createdAt).toLocaleString()}</small></div>)}</div><Field label="Reply to user"><Textarea resize="vertical" rows={3} value={reply} onChange={(_: ChangeEvent<HTMLTextAreaElement>, value: { value: string }) => setReply(value.value)} placeholder="Write a reply" /><Button appearance="primary" disabled={inboxBusy || !reply.trim()} onClick={() => void sendReply()}>{inboxBusy ? 'Sending...' : 'Send reply'}</Button></Field></> : <Text className="muted">Select a conversation to read and reply.</Text>}</div>
      </div>
    </section>
  </section>;
}
