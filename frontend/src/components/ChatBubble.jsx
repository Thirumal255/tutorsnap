export default function ChatBubble({ message, sender, isLoading }) {
  const isBuddy = sender === 'buddy'

  return (
    <div className={`flex items-start gap-2 my-2 ${isBuddy ? 'justify-start' : 'justify-end'}`}>
      {isBuddy && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white font-bold text-sm">
          B
        </div>
      )}
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
          isBuddy
            ? 'bg-teal-50 text-gray-800 rounded-tl-none border border-teal-100'
            : 'bg-white text-gray-800 rounded-tr-none border border-gray-200'
        }`}
      >
        {isLoading ? (
          <span className="flex gap-1 items-center h-5">
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
          </span>
        ) : (
          message
        )}
      </div>
    </div>
  )
}
