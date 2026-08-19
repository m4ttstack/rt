import { test, expect } from "bun:test";
import { createTheme, defineVocabulary, defineComponent, definePolymorphicComponent, defineCompound, defineGenericComponent } from "@soribashi/core";

test("soribashi core resolves through file:+overrides wiring", () => {
  expect(typeof createTheme).toBe("function");
  expect(typeof defineVocabulary).toBe("function");
  for (const b of [defineComponent, definePolymorphicComponent, defineCompound, defineGenericComponent]) {
    expect(typeof b).toBe("function");
  }
});
