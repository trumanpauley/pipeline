import { useEffect, useState } from 'react';
import { api, type ShareMeta } from '../lib/api';
import { BRAND } from '../config/experiment';
import { Constellation, Loading, Screen } from '../components/ui';

/**
 * An experiment's public address, e.g. /harvard-baseball. Taking part needs a
 * personal invitation (/harvard-baseball/TOKEN), so this page only says what
 * the experiment is. It shows the public preview settings and nothing else.
 */
export function ExperimentPage({ slug }: { slug: string }) {
  const [meta, setMeta] = useState<ShareMeta | null>(null);

  useEffect(() => {
    let alive = true;
    api.shareMeta(slug)
      .then((m) => alive && setMeta(m))
      .catch(() => alive && setMeta({ found: false }));
    return () => { alive = false; };
  }, [slug]);

  useEffect(() => {
    document.title = meta?.found && meta.title ? meta.title : BRAND.hidden;
  }, [meta]);

  if (!meta) return <Loading />;

  if (!meta.found) {
    return (
      <Screen className="center">
        <div className="stack fade-up text-center">
          <Constellation small />
          <h1 className="title">Nothing here.</h1>
          <p className="muted">Check the link you were sent.</p>
        </div>
      </Screen>
    );
  }

  return (
    <Screen className="center">
      <div className="stack fade-up text-center experiment-public" data-testid="experiment-page">
        <Constellation small />
        <p className="eyebrow">Invitation only</p>
        <h1 className="title">{meta.title || 'An experiment about how people are connected'}</h1>
        {meta.description && <p className="muted">{meta.description}</p>}
        <p className="fine">
          This experiment grows through personal invitations. If someone sent you a link, open that link to take part.
        </p>
      </div>
    </Screen>
  );
}
