import "server-only";

/**
 * Read a user's WaniKani progress and return the kanji + vocabulary they've
 * learned (SRS stage Guru or above), so the app can auto-mark those as "known".
 * Read-only; uses a personal access token.
 */

const WK = "https://api.wanikani.com/v2";

interface WkPage<T> {
  data: T[];
  pages: { next_url: string | null };
}
type WkAssignment = { data: { subject_id: number } };
type WkSubject = { object: string; data: { characters: string | null } };

async function wkGet<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Wanikani-Revision": "20170710" },
  });
  if (!res.ok) throw new Error(`WaniKani ${res.status}`);
  return (await res.json()) as T;
}

/** Kanji + vocab strings the user has reached Guru+ (srs stages 5–9). */
export async function fetchWaniKaniKnown(token: string): Promise<string[]> {
  const subjectIds: number[] = [];
  let url: string | null = `${WK}/assignments?srs_stages=5,6,7,8,9`;
  while (url) {
    const page: WkPage<WkAssignment> = await wkGet(url, token);
    for (const a of page.data) subjectIds.push(a.data.subject_id);
    url = page.pages.next_url;
  }

  const known = new Set<string>();
  for (let i = 0; i < subjectIds.length; i += 1000) {
    const ids = subjectIds.slice(i, i + 1000).join(",");
    let surl: string | null = `${WK}/subjects?ids=${ids}`;
    while (surl) {
      const page: WkPage<WkSubject> = await wkGet(surl, token);
      for (const s of page.data) {
        if ((s.object === "kanji" || s.object === "vocabulary") && s.data.characters) {
          known.add(s.data.characters);
        }
      }
      surl = page.pages.next_url;
    }
  }
  return [...known];
}
