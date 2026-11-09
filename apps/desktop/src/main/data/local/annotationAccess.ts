// 本地資料層：個案研究筆記（annotations.json）的單例存取。與 library.json 分開。
import { AnnotationStore } from '../../services/annotationService';
import { userPath } from './paths';

let instance: AnnotationStore | null = null;

export function annotations(): AnnotationStore {
  if (!instance) instance = new AnnotationStore(userPath('annotations.json'));
  return instance;
}
