import { useLocalStorage } from '@mattstack/app-kit/hooks';

/** App-wide "show every message in full" preference. When on, the transcript
    never folds a tall message behind a show-more control. Persisted under one
    key and kept in sync across every hook instance in the tab by the kit's
    localStorage shadow, so the page-bar toggle and each message body read one
    source of truth without any prop drilling. */
export function useExpandAll(): [boolean, (value: boolean) => void] {
  const [expandAll = false, setExpandAll] = useLocalStorage<boolean>({
    key: 'chat-expand-all',
    defaultValue: false,
  });
  return [expandAll, setExpandAll];
}
