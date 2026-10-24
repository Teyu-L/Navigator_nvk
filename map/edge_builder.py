import tkinter as tk
import json
from tkinter import messagebox
from PIL import Image, ImageTk

# === НАСТРОЙКИ КАЛИБРОВКИ ===
# Меняй эти значения, чтобы подогнать красные точки под картинку:
SCALE = 5.0       # Во сколько раз увеличить картинку и координаты (например, 1.5, 2.0, 3.0)
OFFSET_X = 0      # Сдвиг всех точек по горизонтали (в пикселях)
OFFSET_Y = 0      # Сдвиг всех точек по вертикали

class EdgeBuilder:
    def __init__(self, root, image_path, nodes_file):
        self.root = root
        self.edges = []
        self.selected_node = None
        
        # Загрузка узлов
        with open(nodes_file, 'r', encoding='utf-8') as f:
            self.nodes = json.load(f)
            
        # Загрузка и масштабирование картинки
        original_img = Image.open(image_path)
        new_width = int(original_img.width * SCALE)
        new_height = int(original_img.height * SCALE)
        self.img = original_img.resize((new_width, new_height), Image.Resampling.LANCZOS)
        self.tk_img = ImageTk.PhotoImage(self.img)
        
        # Создание фрейма и холста с прокруткой
        frame = tk.Frame(root)
        frame.pack(fill=tk.BOTH, expand=True)
        
        self.canvas = tk.Canvas(frame, scrollregion=(0, 0, new_width, new_height))
        
        hbar = tk.Scrollbar(frame, orient=tk.HORIZONTAL, command=self.canvas.xview)
        hbar.pack(side=tk.BOTTOM, fill=tk.X)
        vbar = tk.Scrollbar(frame, orient=tk.VERTICAL, command=self.canvas.yview)
        vbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        self.canvas.config(xscrollcommand=hbar.set, yscrollcommand=vbar.set)
        self.canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        self.canvas.create_image(0, 0, anchor=tk.NW, image=self.tk_img)
        
        # Отрисовка
        self.draw_nodes()
        self.canvas.bind("<Button-1>", self.on_click)
        
        btn = tk.Button(root, text="Сохранить граф", command=self.save_graph, font=("Arial", 12, "bold"))
        btn.pack(pady=5)

    def get_visual_coords(self, x, y):
        # Применяем масштаб и сдвиг только для отрисовки в окне
        return (x * SCALE) + OFFSET_X, (y * SCALE) + OFFSET_Y

    def draw_nodes(self):
        for node_id, data in self.nodes.items():
            vx, vy = self.get_visual_coords(data['x'], data['y'])
            # Точки и шрифты сделаны компактнее, чтобы не перекрывать друг друга
            self.canvas.create_oval(vx-4, vy-4, vx+4, vy+4, fill="red", outline="black", tags=node_id)
            self.canvas.create_text(vx, vy-10, text=node_id, fill="blue", font=("Arial", 8, "bold"))

    def on_click(self, event):
        # canvasx/y конвертирует координаты клика на экране в координаты на прокручиваемом холсте
        cx = self.canvas.canvasx(event.x)
        cy = self.canvas.canvasy(event.y)
        
        clicked_node = self.find_nearest_node(cx, cy)
        if not clicked_node:
            return

        if self.selected_node is None:
            self.selected_node = clicked_node
            self.canvas.itemconfig(clicked_node, fill="yellow")
        else:
            node1 = self.selected_node
            node2 = clicked_node
            
            if node1 != node2:
                edge_exists = any((e["from"] == node1 and e["to"] == node2) or 
                                  (e["from"] == node2 and e["to"] == node1) for e in self.edges)
                if not edge_exists:
                    self.edges.append({"from": node1, "to": node2})
                    vx1, vy1 = self.get_visual_coords(self.nodes[node1]['x'], self.nodes[node1]['y'])
                    vx2, vy2 = self.get_visual_coords(self.nodes[node2]['x'], self.nodes[node2]['y'])
                    self.canvas.create_line(vx1, vy1, vx2, vy2, fill="green", width=3)
                
            self.canvas.itemconfig(node1, fill="red")
            self.selected_node = None

    def find_nearest_node(self, cx, cy, radius=15):
        for node_id, data in self.nodes.items():
            vx, vy = self.get_visual_coords(data['x'], data['y'])
            if (vx - cx)**2 + (vy - cy)**2 < radius**2:
                return node_id
        return None

    def save_graph(self):
        final_data = {
            "nodes": self.nodes, # Сохраняем исходные координаты, а не увеличенные
            "edges": self.edges
        }
        filename = "final_graph_floor1.json"
        with open(filename, "w", encoding="utf-8") as f:
            json.dump(final_data, f, ensure_ascii=False, indent=4)
        messagebox.showinfo("Готово", f"Граф сохранен в {filename}")

if __name__ == "__main__":
    root = tk.Tk()
    root.title("Сборка связей графа")
    root.geometry("1000x800") # Стартовый размер окна стал больше
    
    app = EdgeBuilder(root, "1floor_shema.png", "nodes_floor1.json")
    root.mainloop()