const BUDDY_EMOJI = {
  robot:   '🤖', fox:    '🦊', panda:  '🐼', lion:    '🦁',
  dolphin: '🐬', owl:    '🦉', dragon: '🐉', wizard:  '🧙',
}

export default function ChatBubble({ message, sender, isLoading, buddyAvatar = 'robot' }) {
  const isBuddy = sender === 'buddy'
  const buddyEmoji = BUDDY_EMOJI[buddyAvatar] || '🤖'

  return (
    <div className={`flex items-end gap-2 my-3 ${isBuddy ? 'justify-start' : 'justify-end'}`}>
      {isBuddy && (
        <div className="flex-shrink-0 w-9 h-9 rounded-2xl bg-gradient-to-br from-[#00A2FF] to-[#0066CC] flex items-center justify-center text-lg shadow-glow-blue animate-float">
          {buddyEmoji}
        </div>
      )}
      <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap shadow-card animate-bounce-in ${
        isBuddy
          ? 'bg-[#16213E] text-white rounded-bl-none border border-[#2D2B5A]'
          : 'bg-gradient-to-br from-[#00A2FF] to-[#0066CC] text-white rounded-br-none'
      }`}>
        {isLoading ? (
          <span className="flex gap-1.5 items-center h-5">
            <span className="w-2 h-2 bg-[#8892B0] rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-2 h-2 bg-[#8892B0] rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-2 h-2 bg-[#8892B0] rounded-full animate-bounce [animation-delay:300ms]" />
          </span>
        ) : (
          message
        )}
      </div>
      {!isBuddy && (
        <div className="flex-shrink-0 w-9 h-9 rounded-2xl bg-gradient-to-br from-[#FF6B9D] to-[#FF3333] flex items-center justify-center text-lg shadow-glow-red">
          🎮
        </div>
      )}
    </div>
  )
}
