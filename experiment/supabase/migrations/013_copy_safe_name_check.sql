-- The Pipeline Experiment - copy-safe name check.
--
-- Run after 012. Replaces one function, nothing else.
--
-- Migration 005's name check listed some characters (zero-width spaces, a
-- byte-order mark, variation selectors, line separators) literally. Browsers
-- often drop those invisible characters when SQL is copied from a web page,
-- which breaks the pattern ("invalid regular expression: invalid character
-- range") and makes every name check fail: joins and seed links alike.
-- This is the same check, written with escape codes only, so it survives any
-- copy and paste. The rules are unchanged.

create or replace function public.px_name_problem(p text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v text := public.px_tidy_name(p);
  folded text;
  compact text;
  dedup text;
  tokens text[];
begin
  if v is null or char_length(v) > 40 then return 'length'; end if;
  -- digits and ASCII symbols other than ' - .
  if v ~ '[0-9!"#$%&()*+,/:;<=>?@\[\\\]^_`{|}~]' then return 'characters'; end if;
  -- control / invisible / formatting characters
  if v ~ '[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFE00-\uFE0F]' then return 'characters'; end if;
  -- quote marks other than apostrophes, bullets, arrows, symbols, emoji, full-width ASCII
  if v ~ '[\u201A-\u201F\u2020-\u2027\u2030-\u205E\u2100-\u2BFF\u3000-\u303F\uFF01-\uFF5E\U0001F000-\U0001FFFF]' then return 'characters'; end if;
  -- must contain a letter, and start with one
  if v ~ '^[\s''’ʼ.\-]' or v !~ '[^\s''’ʼ.\-]' then return 'characters'; end if;
  if v ~ '(.)\1{4,}' then return 'repeat'; end if;
  if (select count(*) from regexp_matches(v, ' ', 'g')) > 5 then return 'spam'; end if;
  if lower(v) ~ '(^|\s)(www|https?)\M' or lower(v) ~ '[[:alpha:]]{2,}\.[[:alpha:]]{2,}' then return 'url'; end if;

  folded := translate(lower(v),
    'àáâãäåāăąçćčďèéêëēėęěìíîïīįıłñńňòóôõöøōőŕřśšşșťțùúûüūůűųýÿźžż',
    'aaaaaaaaacccdeeeeeeeeiiiiiiilnnnoooooooorrssssttuuuuuuuuyyzzz');
  compact := regexp_replace(folded, '[\s''’ʼ.\-]', '', 'g');
  dedup := regexp_replace(compact, '(.)\1+', '\1', 'g');
  tokens := regexp_split_to_array(folded, '[\s''’ʼ.\-]+');

  if exists (
    select 1 from public.moderation_terms t
    where (t.match = 'substring' and (strpos(compact, t.term) > 0
            -- "fuuuck": also check with repeated letters collapsed, for terms that have none
            or (t.term = regexp_replace(t.term, '(.)\1+', '\1', 'g') and strpos(dedup, t.term) > 0)))
       or (t.match = 'word' and (t.term = any(tokens) or compact = t.term))
  ) then
    return 'blocked';
  end if;
  return null;
end $$;

revoke execute on function public.px_name_problem(text) from public, anon, authenticated;
