import { createContext, useContext } from 'react';

export const OwnerDataContext = createContext({
  refreshOwnerData: () => {},
  refreshPendingByDay: (days) => {},
});

export const useOwnerData = () => useContext(OwnerDataContext);
