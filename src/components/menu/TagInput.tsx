'use client';

import { useState } from 'react';

export function TagInput({
  label,
  tags,
  onChange,
  color,
  placeholder,
}: {
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  color: string;
  placeholder?: string;
}) {
  const [inputValue, setInputValue] = useState('');

  const addTag = () => {
    const trimmed = inputValue.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInputValue('');
  };

  const removeTag = (tagToRemove: string) => {
    onChange(tags.filter(t => t !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="flex flex-wrap gap-1 mb-2">
        {tags.map((tag, idx) => (
          <span
            key={idx}
            className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full ${color}`}
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="ml-1 hover:text-red-600"
            >
              &times;
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || `Add ${label.toLowerCase()}...`}
          className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-orange-500 focus:border-orange-500"
        />
        <button
          type="button"
          onClick={addTag}
          className="px-2 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
        >
          Add
        </button>
      </div>
    </div>
  );
}
