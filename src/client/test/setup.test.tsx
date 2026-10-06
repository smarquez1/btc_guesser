import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

function Greeting({ name }: { name: string }) {
  return <h1>Hello, {name}</h1>;
}

describe("client test toolchain", () => {
  it("renders a component and matches with jest-dom", () => {
    render(<Greeting name="world" />);

    expect(
      screen.getByRole("heading", { name: "Hello, world" }),
    ).toBeInTheDocument();
  });
});
