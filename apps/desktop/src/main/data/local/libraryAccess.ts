// 本地資料層：檔案管理（library.json）的單例存取。
import { LibraryStore } from '../../library';
import { userPath } from './paths';

let libraryInstance: LibraryStore | null = null;

export function library(): LibraryStore {
  if (!libraryInstance) libraryInstance = new LibraryStore(userPath('library.json'));
  return libraryInstance;
}
