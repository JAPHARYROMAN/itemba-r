import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PageToolbar } from './page-toolbar';

function SearchToolbar() {
  const [search, setSearch] = useState('');
  return <PageToolbar search={search} onSearch={setSearch} searchPlaceholder="Search customers" />;
}

describe('PageToolbar search', () => {
  it('accepts a search term and clears it from the icon button', async () => {
    const user = userEvent.setup();
    render(<SearchToolbar />);

    const input = screen.getByRole('searchbox', { name: 'Search customers' });
    await user.type(input, 'Amani');

    expect(input).toHaveValue('Amani');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input).toHaveValue('');
  });
});
