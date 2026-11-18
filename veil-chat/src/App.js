import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, BackHandler, FlatList, Modal, Pressable, ScrollView,
  Share, StatusBar, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as SecureStore from 'expo-secure-store';
import { defaultServer, request, serverAddress } from './api';
import { c, s } from './theme';

const sessionKey = 'veil.chat.session';
const endpointKey = 'veil.chat.endpoint';
const filters = ['All', 'Unread', 'Requests'];
const requestModes = [
  ['invite', 'Invite only', 'People need a single-use invite code.', 'key-outline'],
  ['handle', 'Invite or handle', 'People can also send a request using your exact @handle.', 'at-outline'],
  ['closed', 'Closed', 'Pause new requests, revoke invites, and clear pending incoming requests.', 'lock-closed-outline'],
];
const avatarColors = [
  [c.dimViolet, c.violet, 'moon-outline'], [c.darkMint, c.mint, 'leaf-outline'],
  ['#3C2837', '#FFBDEB', 'flower-outline'], ['#263144', '#C1D6FF', 'planet-outline'],
];
const clock = (time) => new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function chatTime(time) {
  if (new Date(time).toDateString() === new Date().toDateString()) return clock(time);
  return new Date(time).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
const nameOf = (chat) => chat.peerAlias || 'Pending request';

function Icon({ name, color = c.white, size = 21 }) {
  return <Ionicons name={name} size={size} color={color} />;
}

function IconButton({ icon, label, onPress, disabled, style, color }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
      style={[s.iconButton, style, disabled && s.disabled]}>
      <Icon name={icon} color={color} />
    </Pressable>
  );
}

function Button({ title, icon, onPress, disabled, secondary, danger, style }) {
  const color = danger ? c.red : (secondary ? c.white : c.bg);
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
      style={[s.button, secondary && s.buttonSecondary, style, disabled && s.disabled]}>
      {icon && <Icon name={icon} size={18} color={color} />}
      <Text style={[s.buttonText, { color }]}>{title}</Text>
    </Pressable>
  );
}

function Field({ label, ...props }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={c.muted} selectionColor={c.violet} style={s.input} {...props} />
    </View>
  );
}

function Avatar({ label }) {
  const variant = Array.from(label).reduce((total, char) => total + char.codePointAt(0), 0) % avatarColors.length;
  const [backgroundColor, color, icon] = avatarColors[variant];
  return <View style={[s.avatar, { backgroundColor }]}><Icon name={icon} color={color} size={25} /></View>;
}

function Brand() {
  return (
    <View style={s.row}>
      <View style={s.logo}><Icon name="sparkles" size={19} color={c.bg} /></View>
      <Text style={s.wordmark}>veil</Text>
    </View>
  );
}

function Hero() {
  return (
    <View style={s.hero} aria-hidden>
      {[106, 154, 206, 260, 318].map((size) => <View key={size} style={[s.orbit, { width: size, height: size }]} />)}
      <View style={[s.logo, { width: 76, height: 76, borderRadius: 25, transform: [{ rotate: '-10deg' }] }]}>
        <Icon name="sparkles" size={37} color={c.bg} />
      </View>
    </View>
  );
}

function Empty({ icon, title, text, action }) {
  return (
    <View style={s.empty}>
      <View style={[s.avatar, { backgroundColor: c.dimViolet }]}><Icon name={icon} size={25} color={c.violet} /></View>
      <Text style={[s.h3, s.center]}>{title}</Text>
      <Text style={[s.copy, s.center]}>{text}</Text>
      {action}
    </View>
  );
}

function ErrorText({ message }) {
  return !!message && <Text accessibilityLiveRegion="polite" style={[s.copy, s.danger]}>{message}</Text>;
}

function Confirm({ title, message, action, onConfirm }) {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: action, style: 'destructive', onPress: onConfirm },
  ]);
}

function Sheet({ visible, title, close, children }) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent>
      <SafeAreaView style={s.modal}>
        <View style={s.top}>
          <Text style={[s.h2, s.fill]}>{title}</Text>
          <IconButton icon="close" label="Close" onPress={close} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.page, { paddingTop: 15 }]}>
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Welcome({ begin, endpoint }) {
  const [server, setServer] = useState(endpoint);
  const [showServer, setShowServer] = useState(!endpoint);
  const [alias, setAlias] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create() {
    if (busy || !alias.trim()) return;
    setBusy(true);
    setError('');
    try {
      await begin(alias.trim(), serverAddress(server));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={[s.page, { paddingTop: 14 }]} keyboardShouldPersistTaps="handled">
      <Brand />
      <Hero />
      <View>
        <Text style={s.h1}>Chat on your terms.</Text>
        <Text style={s.copy}>Pick an alias to get started. Veil never asks for your phone number, email, or address book.</Text>
      </View>
      <Field label="YOUR ALIAS" placeholder="e.g. Night Bloom" value={alias} onChangeText={setAlias}
        maxLength={32} autoCorrect={false} returnKeyType="go" onSubmitEditing={create} />
      {showServer && <Field label="CHAT SERVER" placeholder="https://chat.example.com"
        value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" />}
      <ErrorText message={error} />
      <Button title={busy ? 'Creating…' : 'Create identity'} icon="arrow-forward" onPress={create} disabled={busy || !alias.trim() || !server.trim()} />
      {!showServer && <Button title="Set chat server" secondary icon="server-outline" onPress={() => setShowServer(true)} />}
    </ScrollView>
  );
}

function Inbox({ chats, open, start, pending, reload }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const visible = chats.filter((chat) => {
    const matches = (nameOf(chat) + ' ' + chat.preview).toLowerCase().includes(query.trim().toLowerCase());
    return matches && (filter === 'All' || (filter === 'Unread' ? chat.unread > 0 : chat.state === 'pending'));
  });
  return (
    <FlatList
      keyboardShouldPersistTaps="handled" data={visible} keyExtractor={(chat) => chat.id}
      contentContainerStyle={[s.page, { gap: 0, flexGrow: 1 }]} onRefresh={reload} refreshing={pending}
      ListHeaderComponent={(
        <View style={{ gap: 17, paddingTop: 5, paddingBottom: 12 }}>
          <Text style={s.h1}>Chats</Text>
          <View style={[s.row, s.input]}>
            <Icon name="search-outline" color={c.muted} size={20} />
            <TextInput value={query} onChangeText={setQuery} placeholder="Search conversations"
              placeholderTextColor={c.muted} style={[s.fill, { color: c.white, padding: 0, fontSize: 15 }]}
              accessibilityLabel="Search conversations" />
          </View>
          <View style={s.wrap}>
            {filters.map((item) => (
              <Pressable key={item} onPress={() => setFilter(item)} accessibilityRole="button" accessibilityState={{ selected: item === filter }}
                style={[s.chip, item === filter && s.chipActive]}>
                <Text style={[s.chipText, item === filter && s.mintText]}>{item}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      ListEmptyComponent={(
        <Empty icon={query ? 'search-outline' : 'chatbubbles-outline'}
          title={query ? 'No matches' : filter === 'All' ? 'A quiet inbox' : `No ${filter.toLowerCase()} chats`}
          text={query ? 'Try a different alias or keyword.' : filter === 'All' ? 'Start with an invite code or an exact @handle.' : 'They’ll appear here when you have any.'}
          action={!query && filter === 'All' && <Button title="New chat" icon="create-outline" onPress={start} />}
        />
      )}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" onPress={() => open(item)} style={[s.row, s.chatRow, s.divider]}>
          <Avatar label={nameOf(item)} />
          <View style={s.fill}>
            <Text numberOfLines={1} style={s.h3}>{nameOf(item)}</Text>
            <Text numberOfLines={1} style={s.copy}>{item.state === 'pending'
              ? item.incoming ? 'Sent you a chat request' : 'Waiting for acceptance'
              : item.preview || 'Conversation started'}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <Text style={s.small}>{chatTime(item.updatedAt)}</Text>
            {!!item.unread && <View style={s.badge}><Text style={{ color: c.bg, fontWeight: '800', fontSize: 11 }}>{item.unread > 99 ? '99+' : item.unread}</Text></View>}
          </View>
        </Pressable>
      )}
    />
  );
}

function Identity({ profile, api, update, erase }) {
  const [draft, setDraft] = useState(profile);
  const [invite, setInvite] = useState(null);
  const [blocks, setBlocks] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const changed = draft.alias !== profile.alias || draft.handle !== profile.handle || draft.requests !== profile.requests;
  async function perform(action) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try { await action(); } catch (failure) { setError(failure.message); } finally { locked.current = false; setBusy(false); }
  }
  function save() {
    const commit = () => perform(async () => {
      const next = await api('/profile', 'PATCH', draft);
      setDraft(next);
      update(next);
      if (next.requests === 'closed') setInvite(null);
      setNotice('Identity saved.');
    });
    if (draft.requests === 'closed' && profile.requests !== 'closed') {
      Confirm({ title: 'Close chat requests?', message: 'Your invite will be revoked and pending incoming requests will be cleared.', action: 'Close requests', onConfirm: commit });
    } else commit();
  }
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.page, { paddingTop: 5 }]}>
      <Text style={s.h1}>Identity</Text>
      <View style={[s.card, s.row]}>
        <Avatar label={profile.alias} />
        <View style={s.fill}>
          <Text style={s.h3} numberOfLines={1}>{profile.alias}</Text>
          <Text style={s.small}>{profile.requests === 'handle' ? `Discoverable as @${profile.handle}` : profile.requests === 'closed' ? 'Requests closed' : 'Invite-only discovery'}</Text>
        </View>
      </View>
      <Field label="DEFAULT ALIAS" value={draft.alias} onChangeText={(alias) => setDraft({ ...draft, alias })} maxLength={32} />
      <Text style={s.small}>You can choose a different alias for each conversation.</Text>
      <Field label="OPTIONAL HANDLE" placeholder="e.g. night_bloom" autoCapitalize="none" autoCorrect={false}
        value={draft.handle} onChangeText={(handle) => setDraft({ ...draft, handle })} maxLength={25} />
      <View style={{ gap: 8 }}>
        <Text style={s.label}>WHO CAN REQUEST A CHAT</Text>
        {requestModes.map(([value, label, description, icon]) => (
          <Pressable key={value} style={[s.card, s.row, draft.requests === value && { borderColor: c.violet }]}
            onPress={() => setDraft({ ...draft, requests: value })} accessibilityRole="radio" accessibilityState={{ checked: draft.requests === value }}>
            <Icon name={icon} color={c.violet} />
            <View style={s.fill}><Text style={s.h3}>{label}</Text><Text style={s.small}>{description}</Text></View>
            {draft.requests === value && <Icon name="checkmark-circle" color={c.mint} size={19} />}
          </Pressable>
        ))}
      </View>
      <Button title="Save identity" onPress={save} disabled={busy || !changed || !draft.alias.trim()} />
      <View style={s.card}>
        <Text style={s.h3}>Invite code</Text>
        <Text style={s.copy}>Each code works once and expires after 24 hours. Creating a new code revokes the previous one.</Text>
        {invite && <Text selectable style={[s.whiteText, { fontFamily: 'monospace' }]}>{invite.code}</Text>}
        {invite && <Button title="Share code" icon="share-social-outline" secondary onPress={() => perform(() => Share.share({ message: invite.code }))} disabled={busy} />}
        <Button title="Create invite code" icon="key-outline" onPress={() => perform(async () => setInvite(await api('/invite', 'POST', {})))}
          disabled={busy || profile.requests === 'closed'} secondary />
        <Button title="Revoke invite" secondary disabled={busy || profile.requests === 'closed'} onPress={() => perform(async () => {
          await api('/invite', 'DELETE');
          setInvite(null);
          setNotice('Invite revoked.');
        })} />
      </View>
      <View style={s.card}>
        <Text style={s.h3}>Blocked identities</Text>
        {blocks === null ? <Button title="View blocked identities" secondary disabled={busy} onPress={() => perform(async () => setBlocks((await api('/blocks')).blocks))} />
          : blocks.length === 0 ? <Text style={s.copy}>No blocked identities.</Text>
          : blocks.map((entry) => (
            <View key={entry.id} style={s.row}>
              <Text style={[s.copy, s.fill]}>{entry.label}</Text>
              <Button title="Unblock" secondary disabled={busy} onPress={() => perform(async () => {
                await api(`/blocks/${entry.id}`, 'DELETE');
                setBlocks((previous) => previous.filter((block) => block.id !== entry.id));
              })} />
            </View>
          ))}
      </View>
      <ErrorText message={error} />
      {!!notice && <Text accessibilityLiveRegion="polite" style={[s.copy, s.mintText]}>{notice}</Text>}
      <Text style={s.small}>The chat server stores message text. Messages are visible to the server operator.</Text>
      <Button title="Delete identity" secondary danger icon="trash-outline" disabled={busy} onPress={() => Confirm({
        title: 'Delete this identity?', message: 'Your chats, messages, handle, and invites will be removed from the server for both participants. This cannot be undone.',
        action: 'Delete identity', onConfirm: () => perform(erase),
      })} />
    </ScrollView>
  );
}

function NewChat({ profile, close, api, open }) {
  const [target, setTarget] = useState('');
  const [alias, setAlias] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function send() {
    if (busy || !target.trim()) return;
    setBusy(true);
    setError('');
    try {
      open(await api('/chats', 'POST', { target, alias: alias.trim() || profile.alias }));
      close();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet visible title="New chat" close={close}>
      <Text style={s.copy}>The recipient must accept before either person can send messages.</Text>
      <Field label="INVITE CODE OR @HANDLE" value={target} onChangeText={setTarget} placeholder="Paste a code or type @handle"
        autoCapitalize="none" autoCorrect={false} maxLength={64} />
      <Field label="YOUR ALIAS IN THIS CHAT" value={alias} onChangeText={setAlias} placeholder={profile.alias} maxLength={32} />
      <ErrorText message={error} />
      <Button title={busy ? 'Sending…' : 'Send request'} icon="arrow-forward" onPress={send} disabled={busy || !target.trim()} />
    </Sheet>
  );
}

function mergeMessages(current, incoming) {
  const unique = new Map([...current, ...incoming].map((message) => [message.id, message]));
  return [...unique.values()].sort((a, b) => b.id - a.id);
}

function Conversation({ chat, api, change, back, missing, active }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [alias, setAlias] = useState(chat.alias);
  const [options, setOptions] = useState(false);
  const [more, setMore] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const sending = useRef(false);
  const lastRead = useRef(0);
  const retryMessage = useRef(null);
  const latestSynced = useRef(0);
  const route = `/chats/${chat.id}`;

  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    let inFlight = false;
    async function sync() {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await api(route);
        if (!live) return;
        change(next);
        if (next.state === 'active') {
          const cursor = latestSynced.current;
          const query = cursor ? `?after=${cursor}` : '';
          const data = await api(`${route}/messages${query}`);
          if (!live) return;
          if (data.messages.length) {
            setMessages((current) => mergeMessages(current, data.messages));
            latestSynced.current = data.messages.at(-1).id;
          }
          if (!cursor) setMore(data.more);
          setReady(true);
          const latest = latestSynced.current;
          if (latest > lastRead.current) {
            await api(route, 'PATCH', { action: 'read', id: latest });
            lastRead.current = latest;
          }
        }
        if (live) setSyncError('');
      } catch (failure) {
        if (live && failure.status === 404) missing();
        else if (live) setSyncError(failure.message);
      } finally {
        inFlight = false;
      }
    }
    sync();
    const timer = setInterval(sync, 2500);
    return () => { live = false; clearInterval(timer); };
  }, [api, route, active]);

  async function perform(action) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try { await action(); } catch (failure) { setError(failure.message); } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function patch(action, nextAlias = undefined) {
    perform(async () => {
      const next = await api(route, 'PATCH', { action, alias: nextAlias });
      if (next.id) {
        change(next);
        if (action === 'alias') setOptions(false);
      } else {
        back();
      }
    });
  }

  function send() {
    const text = draft.trim();
    if (!text) return;
    perform(async () => {
      if (retryMessage.current?.text !== text) {
        retryMessage.current = { text, clientId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` };
      }
      const message = await api(`${route}/messages`, 'POST', retryMessage.current);
      setMessages((current) => mergeMessages(current, [message]));
      retryMessage.current = null;
      setDraft((value) => (value.trim() === text ? '' : value));
    });
  }

  function older() {
    const cursor = messages.at(-1)?.id;
    if (!cursor) return;
    perform(async () => {
      const data = await api(`${route}/messages?before=${cursor}`);
      setMessages((current) => mergeMessages(current, data.messages));
      setMore(data.more);
    });
  }

  return (
    <View style={s.fill}>
      <View style={[s.top, s.divider]}>
        <IconButton icon="arrow-back" label="Back to chats" onPress={back} />
        <Avatar label={nameOf(chat)} />
        <View style={s.fill}>
          <Text style={s.h3} numberOfLines={1}>{nameOf(chat)}</Text>
          <Text style={s.small} numberOfLines={1}>You’re chatting as {chat.alias}</Text>
        </View>
        <IconButton icon="ellipsis-horizontal" label="Conversation settings" onPress={() => { setAlias(chat.alias); setOptions(true); }} />
      </View>
      {chat.state === 'pending' ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.page, { paddingTop: 22 }]}>
          <Text style={s.h2}>{chat.incoming ? 'Accept chat request?' : 'Request sent'}</Text>
          <Text style={s.copy}>{chat.incoming ? `${nameOf(chat)} wants to chat. You choose which alias they see.` : 'You can send a message after your request is accepted.'}</Text>
          {chat.incoming && <Field label="YOUR ALIAS IN THIS CHAT" value={alias} onChangeText={setAlias} maxLength={32} />}
          <ErrorText message={error || syncError} />
          {chat.incoming && <Button title="Accept request" icon="checkmark" disabled={busy || !alias.trim()} onPress={() => patch('accept', alias)} />}
          <Button title={chat.incoming ? 'Decline request' : 'Cancel request'} secondary disabled={busy}
            onPress={() => patch(chat.incoming ? 'decline' : 'cancel')} />
        </ScrollView>
      ) : (
        <>
          <FlatList inverted data={messages} keyExtractor={(message) => String(message.id)} style={s.fill}
            maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 24 }}
            contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 14, gap: 8 }} keyboardShouldPersistTaps="handled"
            ListEmptyComponent={!ready ? <ActivityIndicator color={c.mint} /> : (
              <View style={{ transform: [{ scaleY: -1 }] }}>
                <Empty icon="chatbubble-ellipses-outline" title="Say hello" text={`You’re sharing the alias ${chat.alias} in this chat.`} />
              </View>
            )}
            ListFooterComponent={more && <Button title="Load older messages" secondary onPress={older} disabled={busy} />}
            renderItem={({ item }) => (
              <View style={[s.bubble, item.mine ? s.bubbleMine : s.bubblePeer]}>
                <Text selectable style={s.bubbleText}>{item.text}</Text>
                <Text style={[s.small, { alignSelf: 'flex-end' }]}>{clock(item.at)}</Text>
              </View>
            )}
          />
          <View style={{ paddingHorizontal: 15 }}><ErrorText message={error || syncError} /></View>
          <View style={s.composer}>
            <TextInput accessibilityLabel="Message" placeholder="Message…" placeholderTextColor={c.muted}
              value={draft} onChangeText={setDraft} maxLength={4000} multiline
              style={[s.input, s.fill, { minHeight: 45, maxHeight: 115, paddingVertical: 9 }]} />
            <IconButton icon="arrow-up" label="Send message" onPress={send} disabled={busy || !draft.trim()}
              color={c.bg} style={{ backgroundColor: c.mint }} />
          </View>
        </>
      )}
      <Sheet visible={options} title="Conversation settings" close={() => setOptions(false)}>
        {(chat.state === 'active' || !chat.incoming) && <>
          <Field label="YOUR ALIAS IN THIS CHAT" value={alias} onChangeText={setAlias} maxLength={32} />
          <Button title="Save chat alias" disabled={busy || !alias.trim()} onPress={() => patch('alias', alias)} />
        </>}
        <ErrorText message={error || syncError} />
        <Button title="Block identity" icon="ban-outline" secondary danger disabled={busy} onPress={() => Confirm({
          title: 'Block this identity?', message: 'This chat and its messages will be removed for both participants. Future requests will be blocked.',
          action: 'Block', onConfirm: () => patch('block'),
        })} />
        {chat.state === 'active' && <Button title="Delete conversation" icon="trash-outline" secondary danger disabled={busy} onPress={() => Confirm({
          title: 'Delete conversation?', message: 'This chat and its messages will be removed for both participants.',
          action: 'Delete chat', onConfirm: () => patch('leave'),
        })} />}
      </Sheet>
    </View>
  );
}

function ChatApp() {
  const [booting, setBooting] = useState(true);
  const [token, setToken] = useState(null);
  const [endpoint, setEndpoint] = useState(defaultServer);
  const [profile, setProfile] = useState(null);
  const [chats, setChats] = useState([]);
  const [selected, select] = useState(null);
  const [newChat, showNewChat] = useState(false);
  const [tab, setTab] = useState('chats');
  const [online, setOnline] = useState(true);
  const [active, setActive] = useState(AppState.currentState !== 'background');
  const [refreshing, setRefreshing] = useState(false);
  const [bootError, setBootError] = useState('');
  const [syncKey, retrySync] = useState(0);
  const revision = useRef(0);
  const sessionRef = useRef(null);

  function reset() {
    sessionRef.current = null;
    setToken(null);
    setProfile(null);
    setChats([]);
    select(null);
    showNewChat(false);
    setTab('chats');
    setBootError('');
  }

  async function restore() {
    setBooting(true);
    setBootError('');
    try {
      const [saved, savedEndpoint] = await Promise.all([
        SecureStore.getItemAsync(sessionKey), SecureStore.getItemAsync(endpointKey),
      ]);
      if (savedEndpoint) setEndpoint(savedEndpoint);
      sessionRef.current = saved;
      setToken(saved);
    } catch {
      setBootError('Could not open the identity on this device.');
    } finally {
      setBooting(false);
    }
  }

  useEffect(() => {
    restore();
    const watcher = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => watcher.remove();
  }, []);

  const api = React.useCallback(async (path, method, body) => {
    try {
      return await request(path, { server: endpoint, token, method, body });
    } catch (error) {
      if (error.status === 401 && sessionRef.current === token) {
        await SecureStore.deleteItemAsync(sessionKey);
        reset();
      }
      throw error;
    }
  }, [token, endpoint]);

  useEffect(() => {
    if (!token || !active) return undefined;
    let live = true;
    let polling = false;
    async function sync() {
      if (polling) return;
      polling = true;
      const version = ++revision.current;
      try {
        const [nextProfile, data] = await Promise.all([api('/profile'), api('/chats')]);
        if (!live || version !== revision.current) return;
        setProfile(nextProfile);
        setChats(data.chats);
        setOnline(true);
        setBootError('');
      } catch (error) {
        if (live && version === revision.current && sessionRef.current === token) {
          setOnline(false);
          setBootError(error.message);
        }
      } finally {
        polling = false;
      }
    }
    sync();
    const timer = setInterval(sync, 5000);
    return () => { live = false; clearInterval(timer); };
  }, [api, token, active, syncKey]);

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selected) { select(null); retrySync((value) => value + 1); return true; }
      if (tab !== 'chats') { setTab('chats'); return true; }
      return false;
    });
    return () => listener.remove();
  }, [selected, tab]);

  async function begin(alias, server) {
    const { token: created } = await request('/session', { server, method: 'POST', body: { alias } });
    await SecureStore.setItemAsync(endpointKey, server);
    await SecureStore.setItemAsync(sessionKey, created);
    sessionRef.current = created;
    setEndpoint(server);
    setToken(created);
    setProfile({ alias, handle: '', requests: 'invite' });
  }

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    const version = ++revision.current;
    try {
      const { chats: result } = await api('/chats');
      if (version === revision.current) { setChats(result); setOnline(true); }
    } catch {
      if (version === revision.current) setOnline(false);
    } finally {
      setRefreshing(false);
    }
  }

  function open(chat) {
    setTab('chats');
    select(chat);
  }

  function back() {
    select(null);
    retrySync((value) => value + 1);
  }

  function updateProfile(next) {
    revision.current += 1;
    setProfile(next);
    retrySync((value) => value + 1);
  }

  async function erase() {
    await api('/profile', 'DELETE');
    await SecureStore.deleteItemAsync(sessionKey);
    reset();
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" />
      {booting ? <ActivityIndicator color={c.mint} style={s.fill} /> : !token && !bootError ? <Welcome begin={begin} endpoint={endpoint} />
        : !profile ? (
          <View style={[s.page, { paddingTop: 20 }]}>
            <Brand />
            <Empty icon="cloud-offline-outline" title={bootError ? 'Connection unavailable' : 'Opening Veil'}
              text={bootError || 'Connecting to the chat server.'}
              action={bootError && <Button title="Try again" onPress={() => token ? retrySync((value) => value + 1) : restore()} />} />
          </View>
        ) : selected ? <Conversation key={selected.id} chat={selected} api={api} change={select} back={back} active={active}
          missing={() => { back(); Alert.alert('Conversation unavailable', 'This conversation may have been removed.'); }} />
        : (
          <View style={s.body}>
            <View style={s.top}>
              <View style={s.fill}><Brand /></View>
              {!online && <Text style={s.small}>Offline</Text>}
              <IconButton icon="create-outline" label="New chat" onPress={() => showNewChat(true)} />
            </View>
            {tab === 'chats' ? <Inbox chats={chats} open={open} start={() => showNewChat(true)} pending={refreshing} reload={refresh} />
              : <Identity profile={profile} api={api} update={updateProfile} erase={erase} />}
            <View style={s.footer}>
              {[['chats', 'Chats', 'chatbubbles-outline'], ['identity', 'Identity', 'finger-print-outline']].map(([key, label, icon]) => (
                <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }}
                  style={[s.tab, tab === key && s.tabActive]} onPress={() => setTab(key)}>
                  <Icon name={icon} color={tab === key ? c.mint : c.muted} size={19} />
                  <Text style={[s.chipText, tab === key && s.mintText]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      {newChat && profile && <NewChat profile={profile} close={() => showNewChat(false)} api={api} open={open} />}
    </SafeAreaView>
  );
}

export default function App() {
  return <SafeAreaProvider><ChatApp /></SafeAreaProvider>;
}
