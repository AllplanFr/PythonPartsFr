import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttributeValueField } from "../components/editor/PropertyPanel";

afterEach(cleanup);
describe("Read-only external attribute values", () => {
  it("keeps a checkbox value immutable", () => {
    const commit = vi.fn();
    render(<AttributeValueField num={45} value="1" readOnly onCommit={commit} />);
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(checkbox).toHaveAttribute("aria-checked", "true");
    expect(commit).not.toHaveBeenCalled();
  });
  it("keeps combobox selection immutable", () => {
    const commit = vi.fn();
    render(<AttributeValueField num={49} value="As-built" readOnly onCommit={commit} />);
    const combo = screen.getByRole("combobox");
    expect(combo).toHaveValue("As-built");
    expect(combo).toHaveProperty("readOnly", true);
    fireEvent.keyDown(combo, { key: "ArrowDown" });
    expect(combo).toHaveValue("As-built");
    expect(commit).not.toHaveBeenCalled();
  });
  it("keeps multiline text unchanged on Enter", () => {
    const commit = vi.fn();
    render(<AttributeValueField num={207} value={"First\nSecond"} readOnly onCommit={commit} />);
    const field = screen.getByRole("textbox");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field).toHaveValue("First\nSecond");
    expect(field).toHaveProperty("readOnly", true);
    expect(commit).not.toHaveBeenCalled();
  });
  it("keeps dates immutable", () => {
    const commit = vi.fn();
    render(<AttributeValueField num={42} value="17/10/2026" readOnly onCommit={commit} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("textbox")).toHaveValue("17/10/2026");
    expect(commit).not.toHaveBeenCalled();
  });
  it.each([76, 96, 180, 267])("does not expose formula %i editing actions", (num) => {
    const commit = vi.fn();
    render(<AttributeValueField num={num} value="@220@*2" readOnly onCommit={commit} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });
});