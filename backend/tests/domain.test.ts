import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STAGE_CATALOG, STAGE_KEYS, deriveCurrentStage, deriveProgress } from '../../shared/src/index';
import { normalizeSourceDomain, normalizeSourceTarget } from '../../shared/src/domain';
import { validateProjectInput, validateProjectPatch } from '../../shared/src/validation';
import { assertStageCoverage, AUTOMATION_CATALOG } from '../src/automation/registry';

describe('normalizeSourceDomain', () => {
  it('принимает домен без протокола и отбрасывает путь', () => {
    assert.deepEqual(normalizeSourceDomain(' Example.COM/about?q=1#top '), {
      ok: true,
      domain: 'example.com',
    });
  });

  it('принимает http и https и убирает порт', () => {
    assert.deepEqual(normalizeSourceDomain('https://WWW.Example.com:8443/ru'), {
      ok: true,
      domain: 'www.example.com',
    });
    assert.deepEqual(normalizeSourceDomain('http://shop.example.com'), {
      ok: true,
      domain: 'shop.example.com',
    });
  });

  it('сохраняет кириллический домен в Unicode', () => {
    const result = normalizeSourceDomain('https://Пример.РФ/catalog');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.domain, 'пример.рф');
    }
  });

  it('отклоняет пустой ввод, IP, localhost, логин и чужой протокол', () => {
    assert.equal(normalizeSourceDomain('  ').ok, false);
    assert.equal(normalizeSourceDomain('https://192.168.0.10').ok, false);
    assert.equal(normalizeSourceDomain('localhost').ok, false);
    assert.equal(normalizeSourceDomain('https://user:pass@example.com').ok, false);
    assert.equal(normalizeSourceDomain('ftp://example.com').ok, false);
    assert.equal(normalizeSourceDomain('javascript:alert(1)').ok, false);
    assert.equal(normalizeSourceDomain('not a domain').ok, false);
    assert.equal(normalizeSourceDomain('example').ok, false);
  });
});

describe('normalizeSourceTarget', () => {
  it('сохраняет путь стартовой страницы и отбрасывает порт с фрагментом', () => {
    assert.deepEqual(normalizeSourceTarget('https://www.liderkarate.ru:443/framespages/index01.htm#top'), {
      ok: true,
      domain: 'www.liderkarate.ru',
      sourceUrl: 'https://www.liderkarate.ru/framespages/index01.htm',
    });
  });

  it('для домена без пути ставит корневой https-адрес', () => {
    assert.deepEqual(normalizeSourceTarget('Shop.Example'), {
      ok: true,
      domain: 'shop.example',
      sourceUrl: 'https://shop.example/',
    });
  });
});

describe('validateProjectInput', () => {
  const valid = {
    name: '  Кафе Север  ',
    sourceDomain: 'https://cafe.example/menu',
    brief: ' Обновить меню и витрину ',
    requirements: '  ',
    mode: 'stage_approval',
  };

  it('нормализует обязательные поля и пустые требования', () => {
    const result = validateProjectInput(valid);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value, {
        name: 'Кафе Север',
        sourceDomain: 'cafe.example',
        sourceUrl: 'https://cafe.example/menu',
        brief: 'Обновить меню и витрину',
        requirements: null,
        mode: 'stage_approval',
      });
    }
  });

  it('сообщает о каждом пропущенном поле и запрещает смену статуса', () => {
    const result = validateProjectInput({ status: 'demo_ready', mode: 'fast' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      const fields = result.errors.map((error) => error.field);
      assert.ok(fields.includes('name'));
      assert.ok(fields.includes('sourceDomain'));
      assert.ok(fields.includes('brief'));
      assert.ok(fields.includes('mode'));
      assert.ok(fields.includes('status'));
    }
  });
});

describe('validateProjectPatch', () => {
  it('требует хотя бы одно редактируемое поле', () => {
    const result = validateProjectPatch({});
    assert.equal(result.ok, false);
  });

  it('запрещает менять прогресс и статус вместе с названием', () => {
    const result = validateProjectPatch({ name: 'Новое', progress: 100, currentStage: 'publish' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((error) => error.field === 'progress'));
      assert.ok(result.errors.some((error) => error.field === 'currentStage'));
    }
  });

  it('позволяет очистить особые требования', () => {
    const result = validateProjectPatch({ requirements: '   ' });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.requirements, null);
    }
  });
});

describe('прогресс и покрытие этапов', () => {
  it('не считает ожидающие этапы выполненными', () => {
    const stages = STAGE_CATALOG.map((definition, index) => ({
      stageKey: definition.key,
      status: 'pending' as const,
      position: index + 1,
    }));
    assert.equal(deriveProgress(stages), 0);
    assert.equal(deriveCurrentStage(stages), 'collect');
    assert.equal(STAGE_CATALOG.length, 7);
  });

  it('сдвигает текущий этап только после реального завершения предыдущих', () => {
    const stages = STAGE_CATALOG.map((definition, index) => ({
      stageKey: definition.key,
      status: index === 0 ? ('completed' as const) : ('pending' as const),
      position: index + 1,
    }));
    assert.equal(deriveProgress(stages), 14);
    assert.equal(deriveCurrentStage(stages), 'analyze');
  });

  it('связывает каждый этап с одним сервисом и помечает подключённым только сбор', () => {
    assertStageCoverage();
    assert.equal(STAGE_KEYS.length, 7);
    assert.equal(AUTOMATION_CATALOG.find((service) => service.id === 'crawler')?.state, 'ok');
    assert.ok(AUTOMATION_CATALOG.filter((service) => service.id !== 'crawler').every((service) => service.state !== 'ok'));
    assert.ok(AUTOMATION_CATALOG.some((service) => service.state === 'not_connected'));
    assert.ok(AUTOMATION_CATALOG.some((service) => service.state === 'in_development'));
  });
});
