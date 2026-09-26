'use client';
import { createContext, useContext } from 'react';
export const RecordsHostContext = createContext(false);
export const useRecordsHost = () => useContext(RecordsHostContext);
