/** SWR-compatible fetcher: GET a URL and return parsed JSON. */
export const fetcher = (url: string) => fetch(url).then(res => res.json());
