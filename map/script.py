import tkinter as tk
from tkinter import simpledialog, messagebox
from PIL import Image, ImageTk
import json

class MapDigitizer:
    def __init__(self, root, image_path, floor_num):
        self.root = root
        self.floor_num = floor_num
        self.nodes = {}  # id: {'x': x, 'y': y, 'floor': floor}
        self.edges = []  # Список словарей {"from": id1, "to": id2}
        
        # Загрузка изображения
        self.img = Image.open(image_path)
        self.tk_img = ImageTk.PhotoImage(self.img)
        
        # Настройка холста по размеру картинки
        self.canvas = tk.Canvas(root, width=self.img.width, height=self.img.height)
        self.canvas.pack()
        self.canvas.create_image(0, 0, anchor=tk.NW, image=self.tk_img)
        
        # Бинды мыши
        self.canvas.bind("<Button-1>", self.add_node)  # Левый клик
        self.canvas.bind("<Button-3>", self.add_edge)  # Правый клик
        
        self.selected_node_for_edge = None
        
        # Кнопка сохранения
        btn = tk.Button(root, text=f"Сохранить граф {floor_num} этажа в JSON", command=self.save_data, font=("Arial", 12, "bold"))
        btn.pack(pady=10)

    def add_node(self, event):
        x, y = event.x, event.y
        # Запрашиваем ID узла
        node_id = simpledialog.askstring("Новый узел", "Введите ID (например: 101, hall_1_A, stairs_main_1):")
        if node_id:
            if node_id in self.nodes:
                messagebox.showerror("Ошибка", "Узел с таким ID уже существует!")
                return
                
            self.nodes[node_id] = {"x": x, "y": y, "floor": self.floor_num}
            
            # Отрисовка узла
            self.canvas.create_oval(x-5, y-5, x+5, y+5, fill="red", outline="black", tags=node_id)
            self.canvas.create_text(x, y-12, text=node_id, fill="blue", font=("Arial", 10, "bold"))

    def add_edge(self, event):
        # Ищем ближайший узел к месту клика
        clicked_node = self.find_nearest_node(event.x, event.y)
        if not clicked_node:
            return

        if self.selected_node_for_edge is None:
            # Выбираем первый узел для связи
            self.selected_node_for_edge = clicked_node
            self.canvas.itemconfig(clicked_node, fill="yellow") # Подсветка выбора
        else:
            # Выбираем второй узел и создаем ребро
            node1 = self.selected_node_for_edge
            node2 = clicked_node
            
            if node1 != node2:
                self.edges.append({"from": node1, "to": node2})
                x1, y1 = self.nodes[node1]['x'], self.nodes[node1]['y']
                x2, y2 = self.nodes[node2]['x'], self.nodes[node2]['y']
                # Отрисовка линии под узлами
                self.canvas.create_line(x1, y1, x2, y2, fill="green", width=3)
                
            # Сброс выделения
            self.canvas.itemconfig(node1, fill="red")
            self.selected_node_for_edge = None

    def find_nearest_node(self, x, y, radius=15):
        for node_id, data in self.nodes.items():
            if (data['x'] - x)**2 + (data['y'] - y)**2 < radius**2:
                return node_id
        return None

    def save_data(self):
        data = {"nodes": self.nodes, "edges": self.edges}
        filename = f"graph_floor_{self.floor_num}.json"
        with open(filename, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        messagebox.showinfo("Готово", f"Данные сохранены в {filename}")

if __name__ == "__main__":
    root = tk.Tk()
    root.title("Оцифровка карты РТФ")
    
    # Укажи нужный файл и номер этажа здесь:
    target_image = "1floor_shema.png"
    floor_number = 1
    
    app = MapDigitizer(root, target_image, floor_number)
    root.mainloop()