import { useState } from 'react';
import { signOut, useAccount, cloudAvailable } from '@/app/cloud';
import { isNativeApp } from '@/platform';
import { AI_PROVIDERS, AiError, complete, useAiSettings, type AiProvider } from '@/app/ai';
import { navigate } from '@/app/router';
import { Row, Section } from '../components/Section';
import { SignIn } from './SignIn';

export function AccountSection() {
  const user = useAccount((s) => s.user);
  if (!cloudAvailable) {
    return (
      <Section title="Account & sharing">
        <Row
          label="Google sign-in"
          hint={
            isNativeApp
              ? 'Open My Doc in your browser to sign in and share. Your documents here stay on this device.'
              : 'Sharing is not set up on this site. Your documents stay on this device.'
          }
        >
          <span className="text-[14px] text-steel">Unavailable</span>
        </Row>
      </Section>
    );
  }
  return (
    <Section
      title="Account & sharing"
      description="Signing in lets you share documents and edit them together. Documents you don't share never leave this device."
    >
      {user ? (
        <>
          <Row label={user.name} hint={user.email}>
            <button type="button" className="btn btn-secondary" onClick={signOut}>
              Sign out
            </button>
          </Row>
          <Row label="Shared with me" hint="Documents other people shared with you.">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate({ name: 'shared' })}
            >
              Open
            </button>
          </Row>
        </>
      ) : (
        <Row label="Sign in" hint="Use your Google account.">
          <SignIn />
        </Row>
      )}
    </Section>
  );
}

export function AiSection() {
  const ai = useAiSettings();
  const user = useAccount((s) => s.user);
  const usage = useAccount((s) => s.ai);
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const hasOwn = !!ai.key.trim();

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      await complete({
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        maxTokens: 8,
      });
      setTest({ ok: true, text: 'The key works.' });
    } catch (e) {
      setTest({
        ok: false,
        text: e instanceof AiError || e instanceof Error ? e.message : 'The test failed.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Section
      title="AI"
      description="Bring your own API key. It stays on this device and is sent only to the provider you pick."
    >
      <Row label="Provider" htmlFor="ai-provider">
        <select
          id="ai-provider"
          className="input"
          value={ai.provider}
          onChange={(e) => ai.update({ provider: e.target.value as AiProvider })}
        >
          {Object.entries(AI_PROVIDERS).map(([id, p]) => (
            <option key={id} value={id}>
              {p.label}
            </option>
          ))}
        </select>
      </Row>
      <Row
        label="API key"
        htmlFor="ai-key"
        hint="Stored unencrypted in this browser's local storage."
      >
        <div className="flex gap-2">
          <input
            id="ai-key"
            className="input w-56"
            type={show ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            placeholder={ai.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
            value={ai.key}
            onChange={(e) => {
              setTest(null);
              ai.update({ key: e.target.value });
            }}
          />
          <button type="button" className="btn btn-secondary" onClick={() => setShow((v) => !v)}>
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
      </Row>
      <Row
        label="Model"
        htmlFor="ai-model"
        hint={`Leave empty to use ${AI_PROVIDERS[ai.provider].model}.`}
      >
        <input
          id="ai-model"
          className="input w-56"
          value={ai.model}
          spellCheck={false}
          onChange={(e) => ai.update({ model: e.target.value })}
        />
      </Row>
      <Row
        label={hasOwn ? 'Using your own key' : 'No key added'}
        hint={
          hasOwn
            ? 'AI requests go straight to your provider and use your own account.'
            : !cloudAvailable
              ? 'Add a key to use AI features.'
              : user
                ? usage?.defaultKey
                  ? `Free allowance: ${Math.max(0, usage.limit - usage.used).toLocaleString()} of ${usage.limit.toLocaleString()} tokens left this month.`
                  : 'There is no free allowance on this site. Add your own key to use AI.'
                : 'Sign in with Google to use a limited free allowance, or add your own key.'
        }
      >
        <div className="flex items-center gap-2">
          {test && (
            <span
              role="status"
              className={`text-caption ${test.ok ? 'text-steel' : 'text-danger'}`}
            >
              {test.text}
            </span>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={testing}
            onClick={() => void runTest()}
          >
            {testing ? 'Testing…' : 'Test'}
          </button>
        </div>
      </Row>
    </Section>
  );
}
