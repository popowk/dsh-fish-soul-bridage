// Path and method inventory extended against dsh-fish-soul v0.15.55 upstream source (2026-11-13).
// No broad /api, prefix, glob, path traversal, or arbitrary DSH RPC forwarding.
export const ROUTES = Object.freeze({
 'GET': [
  '/ui/panel.css', '/diagnose', '/retrieval/state', '/life/state', '/inspector/overview',
  '/channels/state', '/memory/state', '/inspector/person', '/activity', '/diag-log',
  '/backup/state', '/export/memories', '/import/history/state',
  '/models/state', '/voice/state', '/stickers/state', '/stickers/file', '/slang/state',
  '/onboarding/state', '/behavior/state', '/memory/weekly/state', '/memory/weekly/sources', '/storage/state', '/storage/search', '/chat-archive/state', '/chat-archive/list', '/persona/state', '/worldinfo/state', '/update/state'
 ],
 'POST': [
  '/retrieval/config','/retrieval/probe','/retrieval/rebuild', '/life/proactive-config',
  '/inspector/forget','/inspector/importance-lock','/inspector/person','/inspector/memory-edit','/inspector/memory-add',
  '/inspector/bulk','/inspector/memory-restore','/inspector/person/delete', '/import/memories',
  '/channels/qq-config', '/sessions/workspace','/sessions/migrate','/sessions/pause','/sessions/reply-target',
  '/channels/bili-config','/bili/qr/start','/bili/qr/poll','/bili/cookie','/bili/logout',
  '/bili/browse-now','/bili/post-now','/bili/comments-now',
  '/channels/douyin-config','/douyin/browser/start','/douyin/browser/close',
  '/douyin/window','/douyin/browser/rescan','/douyin/screenshot','/douyin/click',
  '/douyin/self-check','/douyin/browse-now','/douyin/post-now','/douyin/comments-now',
  '/douyin/inbox-gap-ack','/douyin/inbox-resolve','/douyin/inbox-dismiss-all','/douyin/post-resolve',
  '/memory/config','/memory/digest-now','/memory/weekly/config','/memory/weekly/run',
  '/storage/config','/storage/snapshot','/storage/restore','/storage/delete','/chat-archive/config','/chat-archive/delete',
  '/backup/now','/backup/restore','/backup/restore-cancel','/backup/config',
  '/import/history/preview','/import/history/start','/import/history/resume',
  '/import/history/discard','/import/history/cancel',
  '/models/config','/web/test','/voice/config','/voice/test',
  '/stickers/config','/stickers/rename','/stickers/delete','/stickers/tags','/stickers/import', '/diag-log/clear',
  '/import/maibot-extras/preview','/import/maibot-extras/apply',
  '/slang/learn','/slang/edit','/slang/config','/onboarding/dismiss',
  '/behavior/config','/groups/note','/chat-models/config','/memory/debug',
  '/diary/topic-remove','/diary/write-now',
  '/persona/fresh','/persona/apply','/persona/undo','/persona/growth',
  '/worldinfo/import','/worldinfo/toggle','/worldinfo/delete','/worldinfo/config','/worldinfo/test',
  '/update/check','/update/config'
 ]
});
export const ALLOW = Object.freeze({ GET:new Set(ROUTES.GET), POST:new Set(ROUTES.POST) });
