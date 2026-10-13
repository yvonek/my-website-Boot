import '@testing-library/jest-dom/vitest';

class ResizeObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: ResizeObserverMock });
Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: () => undefined });
