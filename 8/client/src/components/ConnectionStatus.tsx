interface ConnectionStatusProps {
  isOnline: boolean;
}

export default function ConnectionStatus({ isOnline }: ConnectionStatusProps) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          isOnline
            ? 'bg-green-100 text-green-800'
            : 'bg-red-100 text-red-800'
        }`}
      >
        <span
          className={`w-2 h-2 mr-1.5 rounded-full ${
            isOnline ? 'bg-green-500' : 'bg-red-500'
          } animate-pulse`}
        />
        {isOnline ? '在线' : '离线'}
      </span>
    </div>
  );
}
