import { useStore } from '../store/useStore';
import { dataService } from '../services/dataService';

export default function UserSelector() {
  const { users, currentUser, setCurrentUser } = useStore();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const user = users.find((u) => u.id === e.target.value);
    if (user) {
      setCurrentUser(user);
      dataService.setUserId(user.id);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-gray-600">当前用户:</label>
      <select
        value={currentUser?.id || ''}
        onChange={handleChange}
        className="rounded-md border-gray-300 border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
    </div>
  );
}
