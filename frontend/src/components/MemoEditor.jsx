import React, { lazy, Suspense } from 'react';
import './MemoRichText.css';

const RichEditor = lazy(() => import('./MemoRichEditor'));

export default function MemoEditor(props) {
  return <Suspense fallback={<div className="memo-editor-hint" role="status">{props.isZh ? '正在加载编辑器…' : 'Loading editor…'}</div>}>
    <RichEditor {...props} />
  </Suspense>;
}
