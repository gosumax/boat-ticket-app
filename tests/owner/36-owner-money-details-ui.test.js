import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

describe('Owner Money: management-only details block', () => {
  it('renders only management metrics in the active details section', async () => {
    const previousReact = globalThis.React;
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;

    globalThis.React = React;
    globalThis.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    globalThis.document = {
      addEventListener: () => {},
      removeEventListener: () => {},
      visibilityState: 'visible',
    };

    const { default: OwnerMoneyView } = await import('../../src/views/OwnerMoneyView.jsx');
    const html = renderToStaticMarkup(React.createElement(OwnerMoneyView));

    globalThis.React = previousReact;
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;

    expect(html).toContain('Ожидает оплаты');
    expect(html).toContain('Возвраты');
    expect(html).toContain('Заработано по дню рейса');
    expect(html).toContain('Билеты');
    expect(html).toContain('Рейсы');
    expect(html).toContain('Загрузка');

    expect(html).not.toContain('Источник');
    expect(html).not.toContain('Диапазон');
    expect(html).not.toContain('Канонически до резерва');
    expect(html).not.toContain('Канонически после резерва');
    expect(html).not.toContain('Чистый результат');
    expect(html).not.toContain('Чистыми наличными');
    expect(html).not.toContain('Чистыми картой');
    expect(html).not.toContain('Нал до резерва');
    expect(html).not.toContain('Нал после резерва');
    expect(html).not.toContain('Забрать с продавцов');
    expect(html).not.toContain('К выдаче зарплат');
    expect(html).not.toContain('Бонусы диспетчерам');
    expect(html).not.toContain('Округления в Season');
    expect(html).not.toContain('Итого удержаний фондов');
    expect(html).not.toContain('Cash-часть удержаний');
    expect(html).not.toContain('Card-часть удержаний');
    expect(html).not.toContain('Внутренние расчёты');
    expect(html).not.toContain('owner-money-main-kpi-formula');
    expect(html).not.toContain('owner-money-funds-card');
  });
});
