'use strict';

// The vendored launcher still refers to the chat from its network handlers.
// Replace the instance with a no-op interface rather than merely hiding the
// box: the real constructor also registers keyboard listeners and timers.
module.exports = function removeKxsChat(bundle) {
  const oldInstance = 'this.chat = new KxsChat(this);';
  if (bundle.split(oldInstance).length !== 2) throw new Error('KXS chat constructor not found uniquely');
  bundle = bundle.replace(oldInstance,
    'this.chat = { addChatMessage() {}, addSystemMessage() {}, toggleChat() {} };');

  // Remove the now-unusable Chat toggle, without touching Voice Chat.
  const optionStart = '\n                {\n                    label: "Chat",';
  const optionEnd = '\n                }\n            ],';
  const start = bundle.indexOf(optionStart);
  const end = start < 0 ? -1 : bundle.indexOf(optionEnd, start);
  if (start < 0 || end < 0 || bundle.indexOf(optionStart, start + 1) !== -1) {
    throw new Error('KXS chat menu option not found uniquely');
  }
  return bundle.slice(0, start) + bundle.slice(end + '\n                }'.length);
};
