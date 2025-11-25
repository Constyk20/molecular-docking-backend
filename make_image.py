from pymol import cmd
import os

# Load files
cmd.load("files/receptor.pdbqt", "receptor")
cmd.load("output/output_docked.pdbqt", "ligand")

# Styling
cmd.hide("everything")
cmd.show("cartoon", "receptor")
cmd.color("lightblue", "receptor")
cmd.show("sticks", "ligand")
cmd.color("yellow", "ligand")
cmd.show("spheres", "ligand and element.C")

# Zoom and render
cmd.zoom("all")
cmd.ray(800, 600)
cmd.png("output/result.png", dpi=150)

print("Image saved: output/result.png")