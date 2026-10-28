import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/** Small data-fetching hook: const { data, error, loading, reload } = useApi('/api/products') */
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api(path)
      .then((data) => active && setState({ data, error: null, loading: false }))
      .catch((error) => active && setState({ data: null, error, loading: false }));
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => load(), [load]);
  return { ...state, reload: load, setData: (data) => setState((s) => ({ ...s, data })) };
}
